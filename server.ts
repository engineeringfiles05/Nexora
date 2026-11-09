/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createRateLimiter, rateLimitAi, requireAiAccess } from './server/aiGuards.ts';
import { createGeminiReader } from './server/extraction/imageReader.ts';
import { createJobStore } from './server/extraction/jobs.ts';
import { ExtractionError, runExtraction, type PipelineResult } from './server/extraction/pipeline.ts';
import { solveWithAi } from './server/extraction/solver.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Number of reverse proxies in front of the app, so limits see real client addresses.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0);

const HOUR_MS = 60 * 60 * 1000;
const envLimit = (name: string, fallback: number) => Number(process.env[name]) || fallback;

// Checked before bodies are parsed, so rejected callers can't make the server read a large upload.
const aiAccess = requireAiAccess({
  token: process.env.NEXORA_ADMIN_TOKEN || '',
  isProduction: process.env.NODE_ENV === 'production',
});
const aiDailyBudget = createRateLimiter({ limit: envLimit('AI_DAILY_LIMIT', 500), windowMs: 24 * HOUR_MS });
const solveLimit = rateLimitAi(
  createRateLimiter({ limit: envLimit('AI_SOLVE_HOURLY_LIMIT', 120), windowMs: HOUR_MS }),
  aiDailyBudget
);
const extractLimit = rateLimitAi(
  createRateLimiter({ limit: envLimit('AI_EXTRACT_HOURLY_LIMIT', 30), windowMs: HOUR_MS }),
  aiDailyBudget
);

const MAX_QUESTION_CHARS = 5_000;
const MAX_OPTIONS = 10;
const MAX_RAW_TEXT_CHARS = 1_000_000;
const MAX_PDF_BYTES = 60 * 1024 * 1024;

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey
  ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
  : null;
const READER_MODEL = process.env.GEMINI_READER_MODEL || 'gemini-3.8-flash';
const SOLVER_MODEL = process.env.GEMINI_SOLVER_MODEL || 'gemini-3.8-flash';
const reader = ai ? createGeminiReader(ai, READER_MODEL) : null;
const jobs = createJobStore({ maxRunning: envLimit('EXTRACTION_MAX_PARALLEL_JOBS', 2) });

console.log(`[Nexora Backend] Gemini API key available: ${Boolean(apiKey)} (page-image reading ${reader ? 'on' : 'off'})`);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiKey: Boolean(apiKey),
    imageReading: Boolean(reader),
    service: 'NEXORA ACADEMY AI Examination Engine',
  });
});

// ---------------------------------------------------------------------------
// AI-assisted answers. Output is stored apart from the question; it never edits it.
// ---------------------------------------------------------------------------

app.post('/api/solve-question', aiAccess, solveLimit, express.json({ limit: '1mb' }), async (req, res) => {
  const { question, options, subject, topic } = req.body ?? {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Question statement is required.' });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return res.status(413).json({ error: `Question statement must be ${MAX_QUESTION_CHARS} characters or fewer.` });
  }
  if (options !== undefined && (!Array.isArray(options) || options.length > MAX_OPTIONS)) {
    return res.status(400).json({ error: `Options must be a list of at most ${MAX_OPTIONS} choices.` });
  }
  const choices = (options ?? []).filter((o: any) => typeof o?.key === 'string' && typeof o?.text === 'string');
  if (!ai) {
    return res.status(503).json({ error: 'AI solving is unavailable: GEMINI_API_KEY is not configured on the server.' });
  }
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

// ---------------------------------------------------------------------------
// PDF / questionnaire extraction
// ---------------------------------------------------------------------------

type ExtractionRequest = { bytes?: Uint8Array; text?: string; filename: string; fileSize?: string; crossCheck?: boolean };

function readExtractionRequest(body: any): ExtractionRequest | { status: number; error: string } {
  const { rawText, base64Pdf } = body ?? {};
  if (!rawText && !base64Pdf) return { status: 400, error: 'No document text or PDF data provided.' };
  if ((rawText && typeof rawText !== 'string') || (base64Pdf && typeof base64Pdf !== 'string')) {
    return { status: 400, error: 'Document text and PDF data must be strings.' };
  }
  if (rawText && rawText.length > MAX_RAW_TEXT_CHARS) {
    return { status: 413, error: 'This document is too long. Please split it into smaller files.' };
  }
  const filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.slice(0, 255) : 'Uploaded_Document.pdf';
  const fileSize = typeof body.fileSize === 'string' ? body.fileSize.slice(0, 32) : undefined;
  const crossCheck = typeof body.crossCheck === 'boolean' ? body.crossCheck : undefined;
  if (base64Pdf) {
    const bytes = new Uint8Array(Buffer.from(base64Pdf, 'base64'));
    if (bytes.length > MAX_PDF_BYTES) return { status: 413, error: 'This PDF is larger than 60 MB. Please split it into smaller files.' };
    if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
      return { status: 400, error: 'The uploaded file is not a PDF.' };
    }
    return { bytes, filename, fileSize, crossCheck };
  }
  return { text: rawText, filename, fileSize, crossCheck };
}

const runRequest = (r: ExtractionRequest, onProgress?: (p: any) => void) =>
  runExtraction({ ...r, reader, onProgress, scannedPasses: process.env.OCR_SINGLE_PASS === 'true' ? 1 : 2 });

const resultBody = (result: PipelineResult) => ({
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
});

// Starts an extraction in the background; poll GET /api/extraction-jobs/:id for progress.
app.post('/api/extraction-jobs', aiAccess, extractLimit, express.json({ limit: '85mb' }), (req, res) => {
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

// Same extraction, answered in one request. Kept for scripts and small files.
app.post('/api/extract-pdf', aiAccess, extractLimit, express.json({ limit: '85mb' }), async (req, res) => {
  const request = readExtractionRequest(req.body);
  if ('error' in request) return res.status(request.status).json({ error: request.error });
  try {
    const result = await runRequest(request);
    if (result.questions.length === 0) {
      return res.status(422).json({
        error: 'No examination questions could be identified in this document.',
        report: result.report,
      });
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
    error: status === 413 ? 'The request is too large.' : status === 400 ? 'The request body is not valid JSON.' : 'An unexpected server error occurred',
  });
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NEXORA ACADEMY] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Error]:', err);
});
