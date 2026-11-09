/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads a rendered page image and returns a verbatim transcription. Used for scanned pages,
 * and as an independent second reading of text pages so the text layer can be checked
 * against what is actually printed.
 *
 * The model is asked to transcribe only: it never solves, summarises or corrects, and it
 * wraps anything it is unsure of in ⟦ ⟧ so the uncertainty reaches the reviewer.
 */

import { Type, type GoogleGenAI } from '@google/genai';

export interface ReadLine {
  text: string;
  /** Normalized 0..1 box (top-left origin), when the reader provides one. */
  box?: { x0: number; y0: number; x1: number; y1: number };
  kind: 'text' | 'figure' | 'label';
}

export interface PageImageReader {
  name: string;
  /** `signal` aborts the read (deadline or disconnect); implementations should stop promptly. */
  read(png: Buffer, pageNumber: number, pass: 1 | 2, signal?: AbortSignal): Promise<ReadLine[]>;
}

const INSTRUCTIONS = `You transcribe pages of engineering examination papers into plain text. You are a transcriber, not an editor.

Rules:
1. Copy every visible character exactly as printed, in reading order. On a two-column page, transcribe the whole left column, then the whole right column.
2. Never correct spelling, grammar, punctuation, numbers, units or mathematics, even if they look wrong. Never solve, summarise, explain, reorder or add anything.
3. One output line per printed line. Keep question numbers and choice letters exactly as printed ("12.", "A.", "(b)", "c)").
4. Write symbols as the Unicode characters printed: Ω μ π θ φ ω λ α β Δ ° ± × ÷ √ ∠ ≈ ≤ ≥ ∞ ·.
5. Superscripts: Unicode superscript characters when every character has one (10⁻⁸, m², s⁻¹); otherwise ^(...) such as e^(jωt). Subscripts: Unicode subscript digits (V₁, R₂); letter subscripts as plain letters (Vrms, Xd).
6. A built-up fraction becomes (numerator)/(denominator).
7. If you are not certain of a character, number or word, wrap your best reading in ⟦ ⟧, for example ⟦1.72⟧. If you cannot read it at all, write ⟦?⟧. Do not guess silently.
8. For each figure, diagram, graph or table drawn as a picture, output one line of kind "figure" with its box, then each text label inside it as a line of kind "label".
9. Include headers, footers and page numbers as printed.

Boxes are [ymin, xmin, ymax, xmax] on a 0-1000 scale of the page.`;

const SECOND_PASS = `This is an independent check reading. Read slowly, line by line from left to right, paying particular attention to digits, decimal points, signs, exponents, units and Greek letters.`;

export function createGeminiReader(ai: GoogleGenAI, model: string, timeoutMs = 90_000): PageImageReader {
  return {
    name: `Gemini page-image reading (${model})`,
    async read(png, pageNumber, pass, signal) {
      const call = () =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
                { text: `Transcribe page ${pageNumber}.${pass === 2 ? ` ${SECOND_PASS}` : ''}` },
              ],
            },
          ],
          config: {
            // Cancels the HTTP request to the model when the extraction stops.
            ...(signal ? { abortSignal: signal } : {}),
            systemInstruction: INSTRUCTIONS,
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                lines: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      kind: { type: Type.STRING, enum: ['text', 'figure', 'label'] },
                      text: { type: Type.STRING },
                      box: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                    },
                    required: ['kind', 'text'],
                  },
                },
              },
              required: ['lines'],
            },
          },
        });
      const response = await withRetry(() => withTimeout(call(), timeoutMs, signal), 2, signal);
      const parsed = JSON.parse(response.text || '{}');
      const lines: ReadLine[] = [];
      for (const raw of Array.isArray(parsed.lines) ? parsed.lines : []) {
        if (typeof raw?.text !== 'string') continue;
        const kind = raw.kind === 'figure' || raw.kind === 'label' ? raw.kind : 'text';
        const b = Array.isArray(raw.box) && raw.box.length === 4 && raw.box.every((n: unknown) => typeof n === 'number') ? raw.box : null;
        lines.push({
          text: raw.text,
          kind,
          ...(b ? { box: { y0: clamp(b[0] / 1000), x0: clamp(b[1] / 1000), y1: clamp(b[2] / 1000), x1: clamp(b[3] / 1000) } } : {}),
        });
      }
      return lines;
    },
  };
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** One attempt: rejects at its own timeout, or as soon as `signal` aborts. */
async function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Page reading took longer than ${Math.round(ms / 1000)} s`)), ms);
    if (signal) {
      onAbort = () => reject(signal.reason ?? new Error('Page reading was cancelled.'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  promise.catch(() => {}); // the losing side of the race must not become an unhandled rejection
  return Promise.race([promise, stop]).finally(() => {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Retries transient failures with backoff. Once `signal` aborts there are no more attempts or waits. */
export async function withRetry<T>(fn: () => Promise<T>, retries: number, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw signal.reason;
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (signal?.aborted) throw signal.reason;
      const status = error?.status ?? error?.code;
      const retryable = status === 429 || (typeof status === 'number' && status >= 500) || /timeout|ECONNRESET|fetch failed/i.test(String(error?.message));
      if (!retryable || attempt === retries) break;
      await abortableSleep(1500 * 2 ** attempt, signal);
    }
  }
  throw lastError;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}
