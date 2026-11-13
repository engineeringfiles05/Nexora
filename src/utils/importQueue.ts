/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The PDF import queue. It lives outside React, so imports keep running while the
 * administrator works in other sections of the app; the importer page only shows it.
 *
 * Files are processed one at a time (accuracy over speed, and the server's AI limits):
 * extraction, then optional AI answers and solutions. Every step is saved to Firestore, and
 * the file is kept in this browser, so after a refresh or a lost connection the session shows
 * as interrupted and can be retried; drafts already saved are kept.
 */

import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase.ts';
import type { Course, Question, SubjectId } from '../types/index.ts';
import { applyDuplicateDecision, findDuplicates, type DuplicateDecision } from './bank.ts';
import { cacheFile, cachedFile, forgetFile } from './fileCache.ts';
import { classifyQuestionnaireFile, formatFileSize } from './importFile.ts';
import { deleteSession, listSessions, loadDrafts, saveDrafts, saveSession } from './importPersistence.ts';
import {
  EMPTY_COUNTS,
  computeCounts,
  log,
  needsAnswer,
  newSessionId,
  prepareDrafts,
  storableResult,
  wasInterrupted,
  type ImportSession,
} from './importSessions.ts';
import { applyAiSolution, applySolutionOnly } from './importReview.ts';
import {
  fileToBase64,
  getServerCapabilities,
  readSessionToken,
  requestAiSolution,
  runExtractionJob,
  runExtractionStream,
  sha256Hex,
  uploadTooLarge,
  type JobProgress,
  type ServerCapabilities,
} from './importerClient.ts';

export interface QueueState {
  loaded: boolean;
  loading: boolean;
  loadError?: string;
  sessions: ImportSession[];
  drafts: Record<string, Question[] | undefined>;
  files: Record<string, File | null | undefined>;
  progress: Record<string, JobProgress | undefined>;
  /** Question ids with an AI request in flight. */
  aiBusy: string[];
  saveError?: string;
  server: ServerCapabilities | null;
}

const initial = (): QueueState => ({ loaded: false, loading: false, sessions: [], drafts: {}, files: {}, progress: {}, aiBusy: [], server: null });

let state: QueueState = initial();
const lastSaved = new Map<string, string>(); // `${sessionId}/${questionId}` -> JSON last written

function markSaved(id: string, drafts: Question[]) {
  for (const q of drafts) lastSaved.set(`${id}/${q.id}`, JSON.stringify(q));
}
let owner: string | null = null;
let bank: Question[] = [];
let running = false;
const cancelled = new Set<string>();
const listeners = new Set<() => void>();

function set(patch: Partial<QueueState> | ((s: QueueState) => Partial<QueueState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): QueueState {
  return state;
}

// A different account (or signing out) starts from nothing.
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    if ((user?.uid ?? null) !== owner) {
      owner = user?.uid ?? null;
      cancelled.clear();
      state = initial();
      listeners.forEach((l) => l());
    }
  });
}

/** The bank the drafts are compared against for duplicates. */
export function setBank(questions: Question[]) {
  bank = questions;
}

function session(id: string): ImportSession | undefined {
  return state.sessions.find((s) => s.id === id);
}

function putSession(next: ImportSession) {
  set((s) => ({ sessions: s.sessions.some((x) => x.id === next.id) ? s.sessions.map((x) => (x.id === next.id ? next : x)) : [next, ...s.sessions] }));
}

async function persist(next: ImportSession) {
  putSession(next);
  try {
    await saveSession(next);
  } catch (err) {
    console.warn('Saving import session failed:', err);
    set({ saveError: 'Import progress could not be saved to Firestore. Check your connection, and that the latest firestore.rules are published.' });
  }
}

function patch(id: string, fn: (s: ImportSession) => Partial<ImportSession>, message?: string, level?: 'info' | 'error'): ImportSession | undefined {
  const current = session(id);
  if (!current) return undefined;
  const next: ImportSession = { ...current, ...fn(current), updatedAt: new Date().toISOString() };
  if (message) next.logs = log(current, message, level);
  void persist(next);
  return next;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function load(): Promise<void> {
  if (state.loaded || state.loading) return;
  set({ loading: true, loadError: undefined });
  getServerCapabilities().then((server) => set({ server }));
  try {
    const sessions = await listSessions();
    set({ sessions, loaded: true, loading: false });
    // Nothing runs on page load, so a session still marked as running was stopped.
    for (const s of sessions) {
      if (wasInterrupted(s.status) && !running) {
        patch(s.id, () => ({ status: 'interrupted', error: 'Processing stopped before it finished (the page was closed or refreshed, or the connection was lost).' }), 'Marked as interrupted after reload.', 'error');
      }
    }
  } catch (err) {
    console.warn('Loading imports failed:', err);
    set({
      loading: false,
      loaded: true,
      loadError: 'Saved imports could not be loaded. Check your connection, and that the latest firestore.rules are published (npm run deploy:rules).',
    });
  }
}

/** Loads a session's drafts and its cached file for review. */
export async function open(id: string): Promise<void> {
  const s = session(id);
  if (!s) return;
  if (!state.drafts[id] && s.draftOrder.length) {
    try {
      const drafts = await loadDrafts(s);
      markSaved(id, drafts);
      set((st) => ({ drafts: { ...st.drafts, [id]: drafts } }));
    } catch (err) {
      console.warn('Loading drafts failed:', err);
      set({ saveError: 'The draft questions of this import could not be loaded. Check your connection and try again.' });
    }
  } else if (!state.drafts[id]) {
    set((st) => ({ drafts: { ...st.drafts, [id]: [] } }));
  }
  if (state.files[id] === undefined) {
    const file = s.kind === 'pdf' ? await cachedFile(id) : null;
    set((st) => ({ files: { ...st.files, [id]: file } }));
  }
}

// ---------------------------------------------------------------------------
// Enqueue and process
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  program: Course;
  subjectId: SubjectId | 'auto';
  autoAnswer: boolean;
  /** Import again even if this exact file was imported before. */
  allowRepeat?: boolean;
}

export interface EnqueueOutcome {
  queued: string[];
  repeated: { name: string; sessionId: string }[];
  rejected: { name: string; reason: string }[];
}

export async function enqueue(files: File[], options: EnqueueOptions): Promise<EnqueueOutcome> {
  const outcome: EnqueueOutcome = { queued: [], repeated: [], rejected: [] };
  const server = state.server ?? (await getServerCapabilities());
  if (!state.server) set({ server });
  for (const file of files) {
    const kind = classifyQuestionnaireFile(file);
    if (!kind) {
      outcome.rejected.push({ name: file.name, reason: 'Only PDF and TXT files can be imported.' });
      continue;
    }
    const tooLarge = kind === 'pdf' ? uploadTooLarge(file.size, server) : null;
    if (tooLarge || file.size > 60 * 1024 * 1024) {
      outcome.rejected.push({ name: file.name, reason: tooLarge ?? 'Larger than 60 MB. Split it into smaller files.' });
      continue;
    }
    const fileHash = await sha256Hex(await file.arrayBuffer()).catch(() => '');
    // The same file already imported (or importing): don't process it twice by accident.
    const previous = state.sessions.find((s) => fileHash && s.fileHash === fileHash && s.status !== 'error');
    if (previous && !options.allowRepeat) {
      outcome.repeated.push({ name: file.name, sessionId: previous.id });
      continue;
    }
    const now = new Date().toISOString();
    const id = newSessionId();
    const s: ImportSession = {
      id,
      filename: file.name,
      fileSize: formatFileSize(file.size),
      fileBytes: file.size,
      fileHash,
      kind,
      program: options.program,
      subjectId: options.subjectId,
      autoAnswer: options.autoAnswer,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      createdBy: auth.currentUser?.uid ?? '',
      draftOrder: [],
      publishedIds: [],
      acknowledgedMissing: [],
      duplicateDecisions: {},
      counts: { ...EMPTY_COUNTS },
      logs: [{ at: now, level: 'info', message: `Queued ${file.name} (${formatFileSize(file.size)}) for ${options.program}${options.subjectId === 'auto' ? '' : `, subject ${options.subjectId}`}.` }],
    };
    set((st) => ({ files: { ...st.files, [id]: kind === 'pdf' ? file : null }, drafts: { ...st.drafts, [id]: [] } }));
    // Text files are read in full and kept like PDFs so a retry needs no re-upload.
    await cacheFile(id, file);
    await persist(s);
    outcome.queued.push(id);
  }
  void runQueue();
  return outcome;
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = [...state.sessions].reverse().find((s) => s.status === 'queued');
      if (!next) break;
      await processSession(next.id);
    }
  } finally {
    running = false;
  }
}

function setProgress(id: string, progress: JobProgress | undefined) {
  set((st) => ({ progress: { ...st.progress, [id]: progress } }));
}

async function fileFor(id: string): Promise<File | null> {
  const inMemory = state.files[id];
  if (inMemory) return inMemory;
  const cached = await cachedFile(id);
  if (cached) set((st) => ({ files: { ...st.files, [id]: session(id)?.kind === 'pdf' ? cached : null } }));
  return cached;
}

async function processSession(id: string) {
  const s = session(id);
  if (!s) return;
  const file = await fileFor(id);
  if (!file) {
    patch(id, () => ({ status: 'error', error: 'The original file is no longer stored in this browser. Upload it again.' }), 'File not found in this browser.', 'error');
    return;
  }
  patch(id, () => ({ status: 'extracting', error: undefined }), 'Extraction started.');
  setProgress(id, { stage: 'Uploading the document', percent: 1 });
  const signal = { cancelled: false };
  const watch = setInterval(() => {
    if (cancelled.has(id)) signal.cancelled = true;
  }, 300);
  try {
    const server = state.server ?? (await getServerCapabilities());
    const body =
      s.kind === 'pdf'
        ? { base64Pdf: await fileToBase64(file), filename: s.filename, fileSize: s.fileSize }
        : { rawText: await file.text(), filename: s.filename, fileSize: s.fileSize };
    const token = readSessionToken();
    const data =
      server.streamingExtraction || !server.extractionJobs
        ? await runExtractionStream(body, token, (p) => setProgress(id, p), signal)
        : await runExtractionJob(body, token, (p) => setProgress(id, p), signal);
    if (cancelled.has(id)) throw new Error('Extraction was cancelled.');
    const drafts = prepareDrafts(data.questions, s.program, s.subjectId);
    const { result, droppedPageTexts } = storableResult(data);
    const aiOn = s.autoAnswer && Boolean(server.imageReading);
    set((st) => ({ drafts: { ...st.drafts, [id]: drafts } }));
    // A failed save must not lose the extraction: the drafts stay on screen and are saved
    // again with the next change (flushDrafts compares against what was last written).
    let saveProblem = '';
    try {
      await saveDrafts(id, drafts);
      markSaved(id, drafts);
    } catch (err: any) {
      console.warn('Saving drafts failed:', err);
      saveProblem = ` Saving the drafts to Firestore failed (${err?.message || err}); they are kept on this page and saved again with your next change.`;
      set({ saveError: 'The extracted questions could not be saved to Firestore yet. They are kept on this page; check your connection, and that the latest firestore.rules are published.' });
      scheduleRetrySave(id);
    }
    const current = session(id)!;
    const ready: ImportSession = {
      ...current,
      result,
      draftOrder: drafts.map((q) => q.id),
      status: aiOn && drafts.some(needsAnswer) ? 'answering' : 'ready',
      counts: computeCounts({ result, publishedIds: [] }, drafts, findDuplicates(bank, drafts)),
      updatedAt: new Date().toISOString(),
      logs: log(
        current,
        `Extracted ${drafts.length} question(s) from ${data.totalPages} page(s); report status ${data.report.overallStatus}, ${data.report.questionsRequiringVerification} need review.${droppedPageTexts ? ' Page texts were too large to save and are kept only until reload.' : ''}${saveProblem}`,
        saveProblem ? 'error' : 'info'
      ),
    };
    await persist(ready);
    if (s.autoAnswer && !server.imageReading) {
      patch(id, () => ({}), 'Automatic answers skipped: AI is not configured on the server (GEMINI_API_KEY).', 'error');
    }
    if (ready.status === 'answering') await answerAll(id, { auto: true });
  } catch (err: any) {
    const message = err?.message || 'The document could not be processed.';
    patch(id, () => ({ status: cancelled.has(id) ? 'interrupted' : 'error', error: message }), `Extraction failed: ${message}`, 'error');
  } finally {
    clearInterval(watch);
    cancelled.delete(id);
    setProgress(id, undefined);
  }
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(id: string) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(() => void flushDrafts(id), 800)
  );
}

/** Tries again a little later, for example once the connection is back. */
function scheduleRetrySave(id: string) {
  setTimeout(() => void flushDrafts(id), 30_000);
}

export async function flushDrafts(id: string) {
  clearTimeout(saveTimers.get(id));
  const drafts = state.drafts[id];
  const s = session(id);
  if (!drafts || !s) return;
  const changed = drafts.filter((q) => {
    const json = JSON.stringify(q);
    return lastSaved.get(`${id}/${q.id}`) !== json;
  });
  const removed = s.draftOrder.filter((qid) => !drafts.some((q) => q.id === qid));
  const order = drafts.map((q) => q.id);
  let saved = true;
  try {
    if (changed.length || removed.length) await saveDrafts(id, changed, removed);
    markSaved(id, changed);
    removed.forEach((qid) => lastSaved.delete(`${id}/${qid}`));
    if (state.saveError) set({ saveError: undefined });
  } catch (err) {
    saved = false;
    console.warn('Saving drafts failed:', err);
    set({ saveError: 'Your latest review changes could not be saved to Firestore yet. They are kept on this page; check your connection, and that the latest firestore.rules are published.' });
    scheduleRetrySave(id);
  }
  // The counts always follow what is on screen; the stored order only follows saved drafts.
  const latest = session(id) ?? s;
  const counts = computeCounts(latest, drafts, findDuplicates(bank, drafts));
  const orderChanged = saved && JSON.stringify(order) !== JSON.stringify(latest.draftOrder);
  if (orderChanged || JSON.stringify(counts) !== JSON.stringify(latest.counts)) {
    patch(id, () => ({ counts, ...(orderChanged ? { draftOrder: order } : {}) }));
  }
}

/** Every review change goes through here: shown at once, saved to Firestore shortly after. */
export function updateDrafts(id: string, fn: (drafts: Question[]) => Question[]) {
  set((st) => ({ drafts: { ...st.drafts, [id]: fn(st.drafts[id] ?? []) } }));
  scheduleSave(id);
}

export function updateSession(id: string, fn: (s: ImportSession) => Partial<ImportSession>, message?: string) {
  patch(id, fn, message);
}

export function setDuplicateDecision(id: string, questionId: string, decision: DuplicateDecision) {
  patch(id, (s) => ({ duplicateDecisions: { ...s.duplicateDecisions, [questionId]: decision } }));
}

/** Sets the same decision for several duplicates at once ("Keep both" for all, say). */
export function setDuplicateDecisions(id: string, questionIds: string[], decision: DuplicateDecision) {
  patch(id, (s) => ({ duplicateDecisions: applyDuplicateDecision(s.duplicateDecisions, questionIds, decision) }));
}

// ---------------------------------------------------------------------------
// AI answers and solutions
// ---------------------------------------------------------------------------

function setBusy(questionId: string, busy: boolean) {
  set((st) => ({ aiBusy: busy ? [...st.aiBusy, questionId] : st.aiBusy.filter((x) => x !== questionId) }));
}

/**
 * "answer": work out the answer, explanation and solution ("Regenerate answer").
 * "solution": keep the current answer and rewrite only the working ("Regenerate solution").
 */
export async function solveQuestion(id: string, questionId: string, mode: 'answer' | 'solution' = 'answer'): Promise<void> {
  const q = state.drafts[id]?.find((x) => x.id === questionId);
  if (!q) return;
  setBusy(questionId, true);
  try {
    const solution = await requestAiSolution(q, readSessionToken(), mode === 'solution' && q.correctAnswer ? { fixedAnswer: q.correctAnswer } : {});
    updateDrafts(id, (drafts) => drafts.map((x) => (x.id === questionId ? (mode === 'solution' ? applySolutionOnly(x, solution) : applyAiSolution(x, solution)) : x)));
  } finally {
    setBusy(questionId, false);
  }
}

/** Answers every draft that has none yet, two at a time. Runs in the background. */
export async function answerAll(id: string, opts: { auto?: boolean } = {}): Promise<{ done: number; failed: number }> {
  const queue = (state.drafts[id] ?? []).filter(needsAnswer).map((q) => q.id);
  const total = queue.length;
  let done = 0;
  let failed = 0;
  let next = 0;
  const failures: string[] = [];
  patch(id, () => ({ status: 'answering', answering: { done: 0, total, failed: 0 } }), `${opts.auto ? 'Automatic' : 'Requested'} AI answers for ${total} question(s).`);
  const worker = async () => {
    while (next < queue.length) {
      const questionId = queue[next++]!;
      if (cancelled.has(id)) return;
      try {
        await solveQuestion(id, questionId, 'answer');
      } catch (err: any) {
        failed++;
        const number = state.drafts[id]?.find((q) => q.id === questionId)?.originalQuestionNumber;
        failures.push(`#${number ?? '?'}: ${err?.message || err}`);
      }
      done++;
      const s = session(id);
      if (s) putSession({ ...s, answering: { done, total, failed } });
    }
  };
  await Promise.all([worker(), worker()]);
  await flushDrafts(id);
  const wasCancelled = cancelled.has(id);
  cancelled.delete(id);
  patch(
    id,
    () => ({ status: wasCancelled ? 'interrupted' : 'ready', answering: { done, total, failed } }),
    `AI answers: ${done - failed} of ${total} done${failed ? `, ${failed} failed (${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''})` : ''}${wasCancelled ? ', stopped by the administrator' : ''}.`,
    failed ? 'error' : 'info'
  );
  return { done, failed };
}

// ---------------------------------------------------------------------------
// Retry, cancel, delete
// ---------------------------------------------------------------------------

/**
 * Retries a failed or interrupted session. If its questions were already extracted, only the
 * missing answers are generated; otherwise the file is extracted again (replacing old drafts).
 * `reextract` forces a fresh extraction ("Retry extraction"), discarding review changes.
 */
export async function retry(id: string, opts: { reextract?: boolean } = {}): Promise<void> {
  const s = session(id);
  if (!s) return;
  if (!opts.reextract && s.draftOrder.length && s.result) {
    await open(id);
    if (s.autoAnswer && (state.drafts[id] ?? []).some(needsAnswer)) {
      void answerAll(id);
    } else {
      patch(id, () => ({ status: 'ready', error: undefined }), 'Resumed: questions were already extracted.');
    }
    return;
  }
  const file = await fileFor(id);
  if (!file) {
    patch(id, () => ({ status: 'error', error: 'The original file is no longer stored in this browser. Upload it again.' }), 'Retry failed: file not found in this browser.', 'error');
    return;
  }
  if (s.draftOrder.length) {
    await saveDrafts(id, [], s.draftOrder).catch(() => {});
    s.draftOrder.forEach((qid) => lastSaved.delete(`${id}/${qid}`));
  }
  set((st) => ({ drafts: { ...st.drafts, [id]: [] } }));
  patch(id, () => ({ status: 'queued', error: undefined, draftOrder: [], result: undefined, publishedIds: [], acknowledgedMissing: [], duplicateDecisions: {}, counts: { ...EMPTY_COUNTS } }), 'Queued again for extraction.');
  void runQueue();
}

export function cancel(id: string) {
  cancelled.add(id);
  const s = session(id);
  if (s?.status === 'queued') {
    cancelled.delete(id);
    patch(id, () => ({ status: 'interrupted', error: 'Cancelled before it started.' }), 'Cancelled by the administrator.');
  }
}

export async function remove(id: string): Promise<void> {
  const s = session(id);
  if (!s) return;
  cancelled.add(id);
  await deleteSession(s);
  await forgetFile(id);
  set((st) => {
    const { [id]: _d, ...drafts } = st.drafts;
    const { [id]: _f, ...files } = st.files;
    return { sessions: st.sessions.filter((x) => x.id !== id), drafts, files };
  });
}
