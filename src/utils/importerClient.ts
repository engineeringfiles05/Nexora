/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiSolution, ExtractionIssue, ExtractionReport, Question } from '../types/index.ts';

export const ADMIN_TOKEN_SESSION_KEY = 'nexora.adminToken';

export function readSessionToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function writeSessionToken(token: string) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
  } catch {
    // Private mode: the token just isn't remembered.
  }
}

export interface ExtractionResult {
  filename: string;
  totalPages: number;
  documentHash: string;
  sourcePdfId: string;
  questions: Question[];
  report: ExtractionReport;
  documentIssues: ExtractionIssue[];
  preamble: string;
  pageTexts: { page: number; text: string }[];
  engine: string;
}

export interface JobProgress {
  stage: string;
  percent: number;
  page?: number;
  totalPages?: number;
}

const headers = (token: string) => ({
  'Content-Type': 'application/json',
  ...(token ? { 'x-nexora-admin-token': token } : {}),
});

async function readJson(res: Response): Promise<any> {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`The server returned an unexpected response (HTTP ${res.status}). ${text.slice(0, 120)}`);
  }
  return res.json();
}

export async function getServerCapabilities(): Promise<{ imageReading: boolean; adminTokenRequired: boolean }> {
  try {
    const res = await fetch('/api/health');
    const data = await readJson(res);
    return {
      imageReading: Boolean(data.imageReading ?? data.hasApiKey),
      // Older servers don't report it; assume a token may be needed.
      adminTokenRequired: data.adminTokenRequired !== false,
    };
  } catch {
    return { imageReading: false, adminTokenRequired: true };
  }
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  return btoa(binary);
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Starts a server extraction job and polls it until it finishes. */
export async function runExtractionJob(
  body: { base64Pdf?: string; rawText?: string; filename: string; fileSize?: string },
  token: string,
  onProgress: (p: JobProgress) => void,
  signal?: { cancelled: boolean }
): Promise<ExtractionResult> {
  const start = await fetch('/api/extraction-jobs', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
  const started = await readJson(start);
  if (!start.ok) throw new Error(started?.error || `Extraction could not start (HTTP ${start.status}).`);
  const jobId: string = started.jobId;
  for (;;) {
    if (signal?.cancelled) throw new Error('Extraction was cancelled.');
    await new Promise((r) => setTimeout(r, 900));
    const res = await fetch(`/api/extraction-jobs/${jobId}`, { headers: headers(token) });
    const job = await readJson(res);
    if (!res.ok) throw new Error(job?.error || `Lost track of the extraction (HTTP ${res.status}).`);
    if (job.progress) onProgress(job.progress);
    if (job.status === 'done') return job.result as ExtractionResult;
    if (job.status === 'error') throw new Error(job.error || 'Extraction failed.');
  }
}

export async function requestAiSolution(
  q: Pick<Question, 'question' | 'options' | 'subjectName' | 'topic'>,
  token: string
): Promise<AiSolution> {
  const res = await fetch('/api/solve-question', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ question: q.question, options: q.options, subject: q.subjectName, topic: q.topic }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || `AI solving failed (HTTP ${res.status}).`);
  return data.solution as AiSolution;
}
