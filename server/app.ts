/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The API, shared by the long-running Node server (server.ts) and the Vercel function
 * (api/index.ts). On serverless hosting a request may land on any instance, an instance can
 * be stopped between requests, a function may run for at most a few minutes, and request
 * and unstreamed response bodies are capped at 4.5 MB. So there:
 * - the in-memory extraction jobs (start, then poll) are switched off with a clear error;
 * - extraction runs inside one streamed request (POST /api/extract-stream), which reports
 *   progress as it goes, is not subject to the response cap, and stops with a clear error
 *   before the platform's time limit instead of being cut off;
 * - uploads above the platform's request limit are refused with an explanation.
 */

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { createRateLimiter, rateLimitAi, requireAiAccess } from './aiGuards.ts';
import { createGeminiReader } from './extraction/imageReader.ts';
import { createJobStore } from './extraction/jobs.ts';
import { ExtractionError, runExtraction, type ExtractionProgress, type PipelineResult } from './extraction/pipeline.ts';
import { solveWithAi } from './extraction/solver.ts';

export interface AppEnv {
  [key: string]: string | undefined;
}

/** Vercel request bodies are capped at 4.5 MB; base64 adds a third, so ~3.2 MB of PDF. */
export const SERVERLESS_MAX_UPLOAD_BYTES = 3_200_000;
const SELF_HOSTED_MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export function createApp(env: AppEnv = process.env) {
  const app = express();
  const serverless = Boolean(env.VERCEL) || env.NEXORA_SERVERLESS === 'true';
  const isProduction = env.NODE_ENV === 'production';

  // Number of reverse proxies in front of the app, so limits see real client addresses.
  app.set('trust proxy', serverless ? 1 : Number(env.TRUST_PROXY_HOPS) || 0);

  const HOUR_MS = 60 * 60 * 1000;
  const envLimit = (name: string, fallback: number) => Number(env[name]) || fallback;

  // Checked before bodies are parsed, so rejected callers can't make the server read a large upload.
  const aiAccess = requireAiAccess({ token: env.NEXORA_ADMIN_TOKEN || '', isProduction: isProduction || serverless });
  // Per process. On serverless each instance counts separately, so these are a floor, not a cap.
  const aiDailyBudget = createRateLimiter({ limit: envLimit('AI_DAILY_LIMIT', 500), windowMs: 24 * HOUR_MS });
  const solveLimit = rateLimitAi(createRateLimiter({ limit: envLimit('AI_SOLVE_HOURLY_LIMIT', 120), windowMs: HOUR_MS }), aiDailyBudget);
  const extractLimit = rateLimitAi(createRateLimiter({ limit: envLimit('AI_EXTRACT_HOURLY_LIMIT', 30), windowMs: HOUR_MS }), aiDailyBudget);

  const MAX_QUESTION_CHARS = 5_000;
  const MAX_OPTIONS = 10;
  const MAX_RAW_TEXT_CHARS = 1_000_000;
  const maxUploadBytes = serverless ? SERVERLESS_MAX_UPLOAD_BYTES : SELF_HOSTED_MAX_UPLOAD_BYTES;
  // Leave headroom under Vercel's 300 s function limit to send a clear error.
  const extractionBudgetMs = envLimit('EXTRACTION_TIME_BUDGET_MS', serverless ? 270_000 : 0);

  const apiKey = env.GEMINI_API_KEY || '';
  const ai = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } }) : null;
  const READER_MODEL = env.GEMINI_READER_MODEL || 'gemini-3.8-flash';
  const SOLVER_MODEL = env.GEMINI_SOLVER_MODEL || 'gemini-3.8-flash';
  const reader = ai ? createGeminiReader(ai, READER_MODEL) : null;
  const jobs = serverless ? null : createJobStore({ maxRunning: envLimit('EXTRACTION_MAX_PARALLEL_JOBS', 2) });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      hasApiKey: Boolean(apiKey),
      imageReading: Boolean(reader),
      // Never return the admin token here: this route is public. Development doesn't need one.
      adminTokenRequired: Boolean(env.NEXORA_ADMIN_TOKEN) || isProduction || serverless,
      platform: serverless ? 'serverless' : 'server',
      extractionJobs: Boolean(jobs),
      streamingExtraction: true,
      maxUploadBytes,
      ...(extractionBudgetMs ? { extractionTimeLimitSeconds: Math.floor(extractionBudgetMs / 1000) } : {}),
      service: 'NEXORA ACADEMY AI Examination Engine',
    });
  });

  // -------------------------------------------------------------------------
  // AI-assisted answers. Output is stored apart from the question; it never edits it.
  // -------------------------------------------------------------------------

  app.post('/api/solve-question', aiAccess, solveLimit, express.json({ limit: '1mb' }), async (req, res) => {
    const { question, options, subject, topic } = req.body ?? {};
    if (!question || typeof question !== 'string') return res.status(400).json({ error: 'Question statement is required.' });
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(413).json({ error: `Question statement must be ${MAX_QUESTION_CHARS} characters or fewer.` });
    }
    if (options !== undefined && (!Array.isArray(options) || options.length > MAX_OPTIONS)) {
      return res.status(400).json({ error: `Options must be a list of at most ${MAX_OPTIONS} choices.` });
    }
    const choices = (options ?? []).filter((o: any) => typeof o?.key === 'string' && typeof o?.text === 'string');
    if (!ai) return res.status(503).json({ error: 'AI solving is unavailable: GEMINI_API_KEY is not configured on the server.' });
    try {
      const solution = await solveWithAi(ai, SOLVER_MODEL, {
        question,
        options: choices,
        subject: typeof subject === 'string' ? subject : undefined,
        topic: typeof topic === 'string' ? topic : undefined,
      });
      return res.json({ solution });
    } catch (error: any) {
      console.error('[Solve Question Error]:', error?.message);
      return res.status(502).json({ error: 'The AI service could not solve this question. Please try again.' });
    }
  });

  // -------------------------------------------------------------------------
  // PDF / questionnaire extraction
  // -------------------------------------------------------------------------

  type ExtractionRequest = { bytes?: Uint8Array; text?: string; filename: string; fileSize?: string; crossCheck?: boolean };

  function readExtractionRequest(body: any): ExtractionRequest | { status: number; error: string } {
    const { rawText, base64Pdf } = body ?? {};
    if (!rawText && !base64Pdf) return { status: 400, error: 'No document text or PDF data provided.' };
    if ((rawText && typeof rawText !== 'string') || (base64Pdf && typeof base64Pdf !== 'string')) {
      return { status: 400, error: 'Document text and PDF data must be strings.' };
    }
    if (rawText && rawText.length > MAX_RAW_TEXT_CHARS) return { status: 413, error: 'This document is too long. Please split it into smaller files.' };
    const filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.slice(0, 255) : 'Uploaded_Document.pdf';
    const fileSize = typeof body.fileSize === 'string' ? body.fileSize.slice(0, 32) : undefined;
    const crossCheck = typeof body.crossCheck === 'boolean' ? body.crossCheck : undefined;
    if (base64Pdf) {
      const bytes = new Uint8Array(Buffer.from(base64Pdf, 'base64'));
      if (bytes.length > maxUploadBytes) {
        return { status: 413, error: uploadLimitMessage(maxUploadBytes, serverless) };
      }
      if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
        return { status: 400, error: 'The uploaded file is not a PDF.' };
      }
      return { bytes, filename, fileSize, crossCheck };
    }
    return { text: rawText, filename, fileSize, crossCheck };
  }

  const runRequest = (r: ExtractionRequest, onProgress?: (p: ExtractionProgress) => void, signal?: AbortSignal) =>
    runExtraction({
      ...r,
      reader,
      onProgress,
      signal,
      scannedPasses: env.OCR_SINGLE_PASS === 'true' ? 1 : 2,
      ...(extractionBudgetMs ? { deadline: Date.now() + extractionBudgetMs } : {}),
    });

  const bodyLimit = serverless ? '5mb' : '85mb';

  // Streams NDJSON lines: {"type":"progress",...} while working, then one {"type":"result"} or
  // {"type":"error"}. Works the same locally and on serverless hosting.
  app.post('/api/extract-stream', aiAccess, extractLimit, express.json({ limit: bodyLimit }), async (req, res) => {
    const request = readExtractionRequest(req.body);
    if ('error' in request) return res.status(request.status).json({ error: request.error });
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // A client that disconnects stops the run (and its model requests) instead of leaving it working.
    const cancel = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) cancel.abort();
    });
    const send = (line: unknown) => {
      if (!cancel.signal.aborted && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(line)}\n`);
    };
    // Keeps idle connections and proxies from closing the stream during slow page reads.
    const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
    try {
      const result = await runRequest(request, (p) => send({ type: 'progress', ...p }), cancel.signal);
      send({ type: 'result', result: resultBody(result) });
    } catch (error: any) {
      const status = error instanceof ExtractionError ? error.status : 500;
      if (!(error instanceof ExtractionError)) console.error('[Extraction Error]:', error);
      send({ type: 'error', status, error: error instanceof ExtractionError ? error.message : 'The document could not be processed.' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  // Background jobs (start, then poll) need one long-lived process holding job state.
  const jobsUnavailable = (_req: express.Request, res: express.Response) =>
    res.status(501).json({
      error: 'Background extraction jobs are not available on serverless hosting. Use POST /api/extract-stream.',
      code: 'JOBS_UNAVAILABLE',
    });

  if (jobs) {
    app.post('/api/extraction-jobs', aiAccess, extractLimit, express.json({ limit: bodyLimit }), (req, res) => {
      const request = readExtractionRequest(req.body);
      if ('error' in request) return res.status(request.status).json({ error: request.error });
      const job = jobs.start((onProgress) => runRequest(request, onProgress));
      return res.status(202).json({ jobId: job.id, status: job.status });
    });
    app.get('/api/extraction-jobs/:id', aiAccess, (req, res) => {
      const job = jobs.get(req.params.id);
      if (!job) return res.status(404).json({ error: 'This extraction job was not found or has expired. Please run the extraction again.' });
      return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        ...(job.status === 'done' && job.result ? { result: resultBody(job.result) } : {}),
        ...(job.status === 'error' ? { error: job.error, errorStatus: job.errorStatus } : {}),
      });
    });
  } else {
    app.post('/api/extraction-jobs', aiAccess, jobsUnavailable);
    app.get('/api/extraction-jobs/:id', aiAccess, jobsUnavailable);
  }

  // Same extraction, answered in one request. Kept for scripts and small files.
  app.post('/api/extract-pdf', aiAccess, extractLimit, express.json({ limit: bodyLimit }), async (req, res) => {
    const request = readExtractionRequest(req.body);
    if ('error' in request) return res.status(request.status).json({ error: request.error });
    try {
      const result = await runRequest(request);
      if (result.questions.length === 0) {
        return res.status(422).json({ error: 'No examination questions could be identified in this document.', report: result.report });
      }
      return res.json(resultBody(result));
    } catch (error: any) {
      if (error instanceof ExtractionError) return res.status(error.status).json({ error: error.message });
      console.error('[Extraction Error]:', error);
      return res.status(500).json({ error: 'The document could not be processed.' });
    }
  });

  // Explicit catch-all for /api/* so API requests never fall through to the SPA.
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // JSON errors for body-parser failures (malformed JSON 400, too large 413) and anything else.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[Nexora Server Error]:', err);
    res.status(status).json({
      error:
        status === 413
          ? uploadLimitMessage(maxUploadBytes, serverless)
          : status === 400
            ? 'The request body is not valid JSON.'
            : 'An unexpected server error occurred',
    });
  });

  console.log(`[Nexora Backend] ${serverless ? 'Serverless' : 'Server'} mode; page-image reading ${reader ? 'on' : 'off'}`);
  return app;
}

export function uploadLimitMessage(limit: number, serverless: boolean): string {
  const mb = (limit / (1024 * 1024)).toFixed(limit < 10 * 1024 * 1024 ? 1 : 0);
  return serverless
    ? `This hosting accepts PDFs up to about ${mb} MB per upload. Split the PDF into smaller files, or run the self-hosted server for larger ones.`
    : `This PDF is larger than ${mb} MB. Please split it into smaller files.`;
}

function resultBody(result: PipelineResult) {
  return {
    success: true,
    filename: result.filename,
    totalPages: result.totalPages,
    documentHash: result.documentHash,
    sourcePdfId: result.sourcePdfId,
    questionsCount: result.questions.length,
    questions: result.questions,
    report: result.report,
    documentIssues: result.documentIssues,
    preamble: result.preamble,
    pageTexts: result.pageTexts,
    rawExtractedText: result.pageTexts.map((p) => `--- PAGE ${p.page} ---\n${p.text}`).join('\n\n'),
    engine: result.engine,
  };
}
