/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createRateLimiter, rateLimitAi, requireAiAccess } from './server/aiGuards.ts';

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

// Server-side Gemini API client
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

console.log(`[Nexora Backend] Initializing with Gemini API key available: ${Boolean(apiKey)}`);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiKey: Boolean(apiKey),
    service: 'NEXORA ACADEMY AI Examination Engine',
  });
});

// Dedicated Question Solver endpoint
app.post('/api/solve-question', aiAccess, solveLimit, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { question, options, subject, topic } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question statement is required.' });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(413).json({ error: `Question statement must be ${MAX_QUESTION_CHARS} characters or fewer.` });
    }
    if (options !== undefined && (!Array.isArray(options) || options.length > MAX_OPTIONS)) {
      return res.status(400).json({ error: `Options must be a list of at most ${MAX_OPTIONS} choices.` });
    }

    if (!apiKey) {
      return res.status(503).json({ error: 'AI solving is unavailable: GEMINI_API_KEY is not configured on the server.' });
    }

    const prompt = `You are a master engineering board examination examiner.
Solve the following multiple-choice problem with rigorous mathematical precision and engineering principles:
Question: "${question}"
Options: ${JSON.stringify(options || [])}
Subject: ${subject || 'Engineering'}
Topic: ${topic || 'General'}

Output JSON with:
- correctAnswer: The single letter of the correct choice ("A", "B", "C", or "D").
- explanation: Detailed explanation of why this answer is correct and why other choices are incorrect.
- stepByStepSolution: Step-by-Step mathematical derivation showing formula selection, value substitution, and unit verification.
- formulasUsed: Array of formula strings used in the derivation.
- givenValues: Array of { label: string, value: string } extracted from the problem.
- finalAnswerWithUnit: Final computed value with engineering unit.
- difficulty: "Easy", "Average", or "Difficult"
- verificationStatus: "verified" if high confidence, "needs_verification" if ambiguous.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (error: any) {
    console.error('[Solve Question Error]:', error);
    return res.status(502).json({ error: 'The AI service could not solve this question. Please try again.' });
  }
});

// Multi-page PDFs can take minutes because every question is also solved.
const EXTRACTION_TIMEOUT_MS = Number(process.env.EXTRACTION_TIMEOUT_MS) || 240_000;
const EXTRACTION_TIMEOUT_MESSAGE = 'AI extraction latency exceeded limit';

// Advanced AI-Powered PDF / Questionnaire Question Importer Endpoint
app.post('/api/extract-pdf', aiAccess, extractLimit, express.json({ limit: '50mb' }), async (req, res) => {
  const { rawText, base64Pdf } = req.body;
  const filename = typeof req.body.filename === 'string' ? req.body.filename.slice(0, 255) : 'Uploaded_Document.pdf';

  if (!rawText && !base64Pdf) {
    return res.status(400).json({ error: 'No document text or PDF data provided.' });
  }
  if ((rawText && typeof rawText !== 'string') || (base64Pdf && typeof base64Pdf !== 'string')) {
    return res.status(400).json({ error: 'Document text and PDF data must be strings.' });
  }
  if (rawText && rawText.length > MAX_RAW_TEXT_CHARS) {
    return res.status(413).json({ error: 'This document is too long. Please split it into smaller files.' });
  }

  if (!apiKey) {
    return res.status(503).json({
      error: 'AI extraction is unavailable: GEMINI_API_KEY is not configured on the server. No questions were imported.',
    });
  }

  try {
    const systemInstruction = `You are NEXORA ACADEMY's Senior Board Examination AI Extractor and Solver.
Your mission is to extract genuine examination questions from the uploaded questionnaire and generate complete, verified step-by-step solutions.

CRITICAL INSTRUCTIONS:
1. ONLY extract actual examination questions (multiple-choice questions, computation problems, conceptual board questions).
2. DO NOT extract lecture discussions, introductions, instructions, syllabus outlines, or non-question paragraphs.
3. PRESERVE exact wording, original numbers, options (A, B, C, D), formulas, equations, symbols, and units.
4. INDEPENDENTLY SOLVE each problem:
   - Identify given parameters with units.
   - Choose the governing engineering/math formula.
   - Carry out step-by-step computation.
   - Verify the final answer and unit.
   - Provide a clear conceptual explanation of why the correct option is right and others are distractors.
5. COMPARE with any answer keys or solutions provided in the document:
   - If an answer key exists in the text (e.g. "[Answer: B]" or "Key: B"), extract it in extractedAnswerKey.
   - If the AI-derived answer matches the key, mark verificationStatus as "verified".
   - If there is a discrepancy between key and derivation, mark as "discrepancy_flagged" and explain in explanation.
   - If uncertain, mark as "needs_verification". Never fabricate an answer.
6. CLASSIFY Subject into:
   - "math" (Mathematics)
   - "esas" (Engineering Sciences & Allied Subjects)
   - "ee" (Electrical Engineering Professional Subjects)
7. Provide difficulty: "Easy", "Average", or "Difficult".
8. Provide extractionConfidence as an integer from 0 to 100, and always provide verificationStatus.`;

    let contents: any;
    if (base64Pdf) {
      contents = {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            text: `Extract, independently solve, and categorize all board examination questions from this PDF file (${filename}). Format each extracted question according to the requested JSON schema.`,
          },
        ],
      };
    } else {
      contents = {
        parts: [
          {
            text: `Document text from ${filename}:\n\n${rawText}\n\nExtract, independently solve, and categorize all board examination questions from this text. Format each extracted question according to the requested JSON schema.`,
          },
        ],
      };
    }

    const aiCall = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalQuestionNumber: { type: Type.INTEGER },
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ['key', 'text'],
                },
              },
              correctAnswer: { type: Type.STRING },
              extractedAnswerKey: { type: Type.STRING },
              explanation: { type: Type.STRING },
              stepByStepSolution: { type: Type.STRING },
              formulasUsed: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              givenValues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    value: { type: Type.STRING },
                  },
                },
              },
              finalAnswerWithUnit: { type: Type.STRING },
              subjectId: { type: Type.STRING },
              subjectName: { type: Type.STRING },
              topic: { type: Type.STRING },
              subtopic: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              extractionConfidence: { type: Type.INTEGER },
              verificationStatus: { type: Type.STRING },
            },
            required: [
              'question',
              'options',
              'correctAnswer',
              'explanation',
              'subjectId',
              'topic',
              'difficulty',
            ],
          },
        },
      },
    });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(EXTRACTION_TIMEOUT_MESSAGE)), EXTRACTION_TIMEOUT_MS);
    });

    const response = await Promise.race([aiCall, timeoutPromise]).finally(() => clearTimeout(timer));

    const parsed = JSON.parse(response.text || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(422).json({
        error: `No examination questions were found in "${filename}". Nothing was imported.`,
      });
    }

    console.log(`[Nexora Backend] Gemini extracted ${parsed.length} questions from ${filename}`);
    return res.json({
      success: true,
      filename,
      questionsCount: parsed.length,
      questions: parsed,
    });
  } catch (aiErr: any) {
    console.error('[Gemini AI extract-pdf error]:', aiErr.message);
    if (aiErr.message === EXTRACTION_TIMEOUT_MESSAGE) {
      return res.status(504).json({
        error: `AI extraction timed out on "${filename}". No questions were imported. Try again, or split the PDF into smaller files.`,
      });
    }
    return res.status(502).json({
      error: `The AI service could not process "${filename}". No questions were imported. Please try again.`,
    });
  }
});

// Unknown API routes must not fall through to the SPA's HTML page.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// API clients get JSON errors, including rejected or oversized request bodies.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith('/api/') || res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[API Error]:', err);
  const message =
    status === 413
      ? 'This file is too large to upload. Please split the PDF into smaller files.'
      : status < 500
      ? 'The request could not be read.'
      : 'Internal server error.';
  return res.status(status).json({ error: message });
});

// Setup Vite or static serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
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
