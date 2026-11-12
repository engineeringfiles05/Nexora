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

/**
 * Supplies the signed-in account's Firebase ID token. The server checks it and only lets the
 * verified administrator use the AI routes (see server/firebaseAuth.ts).
 */
type IdTokenProvider = () => Promise<string | null | undefined>;
let idTokenProvider: IdTokenProvider | null = null;

export function setIdTokenProvider(provider: IdTokenProvider | null) {
  idTokenProvider = provider;
}

export function hasIdTokenProvider(): boolean {
  return idTokenProvider !== null;
}

async function headers(token: string): Promise<Record<string, string>> {
  const idToken = idTokenProvider ? await idTokenProvider().catch(() => null) : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'x-nexora-admin-token': token } : {}),
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };
}

export const BACKEND_UNAVAILABLE =
  'The extraction service is not available on this deployment: its API (/api) did not answer. The importer cannot run here until the backend is deployed.';

/** Turns a non-JSON answer (a host's 404/413 page) into an explanation instead of raw text. */
async function readJson(res: Response): Promise<any> {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) throw new Error(BACKEND_UNAVAILABLE);
    if (res.status === 413 || /FUNCTION_PAYLOAD_TOO_LARGE/.test(text)) {
      throw new Error('This upload is larger than the hosting accepts. Split the PDF into smaller files.');
    }
    if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT/.test(text)) {
      throw new Error('The server ran out of time processing this document. Split the PDF into smaller files.');
    }
    throw new Error(`The server returned an unexpected response (HTTP ${res.status}). ${text.slice(0, 120)}`);
  }
  return res.json();
}

export interface ServerCapabilities {
  /** False when /api does not answer with this app's JSON (for example a host 404 page). */
  available: boolean;
  imageReading: boolean;
  adminTokenRequired: boolean;
  /** The server accepts a verified administrator sign-in instead of the admin token. */
  adminSignIn: boolean;
  /** Start-then-poll jobs need one long-lived process; serverless hosting has none. */
  extractionJobs: boolean;
  streamingExtraction: boolean;
  maxUploadBytes?: number;
  timeLimitSeconds?: number;
}

export async function getServerCapabilities(fetcher: typeof fetch = fetch): Promise<ServerCapabilities> {
  const unavailable: ServerCapabilities = { available: false, imageReading: false, adminTokenRequired: true, adminSignIn: false, extractionJobs: false, streamingExtraction: false };
  try {
    const res = await fetcher('/api/health');
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return unavailable;
    const data = await res.json();
    if (data?.status !== 'ok') return unavailable;
    return {
      available: true,
      imageReading: Boolean(data.imageReading ?? data.hasApiKey),
      // Older servers don't report it; assume a token may be needed.
      adminTokenRequired: data.adminTokenRequired !== false,
      adminSignIn: data.adminSignIn === true,
      // Older servers only had jobs.
      extractionJobs: data.extractionJobs !== false,
      streamingExtraction: data.streamingExtraction === true,
      ...(typeof data.maxUploadBytes === 'number' ? { maxUploadBytes: data.maxUploadBytes } : {}),
      ...(typeof data.extractionTimeLimitSeconds === 'number' ? { timeLimitSeconds: data.extractionTimeLimitSeconds } : {}),
    };
  } catch {
    return unavailable;
  }
}

/** Checked before uploading, so the user hears about the limit before waiting for it. */
export function uploadTooLarge(bytes: number, caps: Pick<ServerCapabilities, 'maxUploadBytes'>): string | null {
  if (!caps.maxUploadBytes || bytes <= caps.maxUploadBytes) return null;
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return `This file is ${mb(bytes)} MB, but this deployment accepts PDFs up to about ${mb(caps.maxUploadBytes)} MB. Split the PDF into smaller files and import them one at a time.`;
}

/**
 * Runs an extraction in one streamed request: progress lines arrive as the server works,
 * then the result. Used on every host; required on serverless hosting.
 */
export async function runExtractionStream(
  body: { base64Pdf?: string; rawText?: string; filename: string; fileSize?: string },
  token: string,
  onProgress: (p: JobProgress) => void,
  signal?: { cancelled: boolean },
  fetcher: typeof fetch = fetch
): Promise<ExtractionResult> {
  const controller = new AbortController();
  const res = await fetcher('/api/extract-stream', { method: 'POST', headers: await headers(token), body: JSON.stringify(body), signal: controller.signal });
  if (!res.ok || !res.body) {
    const data = await readJson(res);
    throw new Error(data?.error || `Extraction could not start (HTTP ${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    if (signal?.cancelled) {
      controller.abort();
      throw new Error('Extraction was cancelled.');
    }
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') onProgress(msg);
      else if (msg.type === 'result') return msg.result as ExtractionResult;
      else if (msg.type === 'error') throw new Error(msg.error || 'Extraction failed.');
    }
    if (done) throw new Error('The connection closed before the extraction finished. The server may have run out of time; try a smaller PDF.');
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
  const start = await fetch('/api/extraction-jobs', { method: 'POST', headers: await headers(token), body: JSON.stringify(body) });
  const started = await readJson(start);
  if (!start.ok) throw new Error(started?.error || `Extraction could not start (HTTP ${start.status}).`);
  const jobId: string = started.jobId;
  for (;;) {
    if (signal?.cancelled) throw new Error('Extraction was cancelled.');
    await new Promise((r) => setTimeout(r, 900));
    const res = await fetch(`/api/extraction-jobs/${jobId}`, { headers: await headers(token) });
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
    headers: await headers(token),
    body: JSON.stringify({ question: q.question, options: q.options, subject: q.subjectName, topic: q.topic }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || `AI solving failed (HTTP ${res.status}).`);
  return data.solution as AiSolution;
}
