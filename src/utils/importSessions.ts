/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An import session is one uploaded questionnaire: its settings (program, subject), its
 * extraction result, the draft questions waiting for review, and a processing log. Sessions
 * and drafts are stored in Firestore (utils/importPersistence.ts), admin-only, so they survive
 * refreshes and can be reviewed later. Pure helpers live here so they can be unit-tested.
 */

import type { Course, Question, SubjectId } from '../types/index.ts';
import type { DuplicateDecision, DuplicateMatch } from './bank.ts';
import type { ExtractionResult } from './importerClient.ts';
import { isReviewedForExams } from './bank.ts';
import { SUBJECT_NAMES } from './questionExtractor.ts';

export type ImportStatus = 'queued' | 'extracting' | 'answering' | 'ready' | 'error' | 'interrupted';

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  queued: 'Waiting',
  extracting: 'Extracting',
  answering: 'Generating answers',
  ready: 'Ready for review',
  error: 'Failed',
  interrupted: 'Interrupted',
};

/** The parts of an extraction result kept with the session (the questions are separate drafts). */
export type StoredResult = Omit<ExtractionResult, 'questions'>;

export interface ImportCounts {
  pages: number;
  detected: number;
  extracted: number;
  answered: number;
  solved: number;
  needVerification: number;
  duplicates: number;
  approved: number;
  published: number;
}

export interface ImportLogEntry {
  at: string;
  level: 'info' | 'error';
  message: string;
}

export interface ImportSession {
  id: string;
  filename: string;
  fileSize: string;
  fileBytes: number;
  fileHash: string;
  kind: 'pdf' | 'text';
  program: Course;
  /** "auto": keep the subject each question was classified under. */
  subjectId: SubjectId | 'auto';
  autoAnswer: boolean;
  status: ImportStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  result?: StoredResult;
  /** Draft ids in review order (drafts are stored as separate documents). */
  draftOrder: string[];
  publishedIds: string[];
  acknowledgedMissing: number[];
  duplicateDecisions: Record<string, DuplicateDecision>;
  answering?: { done: number; total: number; failed: number };
  counts: ImportCounts;
  logs: ImportLogEntry[];
}

export const MAX_LOG_ENTRIES = 60;

export function newSessionId(now = Date.now()): string {
  return `imp-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function log(session: ImportSession, message: string, level: ImportLogEntry['level'] = 'info'): ImportLogEntry[] {
  return [...session.logs, { at: new Date().toISOString(), level, message }].slice(-MAX_LOG_ENTRIES);
}

/** Program and subject chosen at upload, applied to every extracted question. Text is untouched. */
export function prepareDrafts(questions: Question[], program: Course, subjectId: SubjectId | 'auto'): Question[] {
  return questions.map((q) => ({
    ...q,
    course: program,
    isPublished: false,
    ...(subjectId !== 'auto' ? { subjectId, subjectName: SUBJECT_NAMES[subjectId] } : {}),
  }));
}

/** Keeps the result small enough for one Firestore document (1 MiB): page texts go first. */
export function storableResult(result: ExtractionResult | StoredResult, limitBytes = 850_000): { result: StoredResult; droppedPageTexts: boolean } {
  const { questions: _q, ...rest } = result as ExtractionResult;
  const stored: StoredResult = {
    filename: rest.filename,
    totalPages: rest.totalPages,
    documentHash: rest.documentHash,
    sourcePdfId: rest.sourcePdfId,
    report: rest.report,
    documentIssues: rest.documentIssues ?? [],
    preamble: (rest.preamble ?? '').slice(0, 20_000),
    pageTexts: rest.pageTexts ?? [],
    engine: rest.engine,
  };
  if (JSON.stringify(stored).length <= limitBytes) return { result: stored, droppedPageTexts: false };
  return { result: { ...stored, pageTexts: [] }, droppedPageTexts: true };
}

export function computeCounts(session: Pick<ImportSession, 'result' | 'publishedIds'>, drafts: Question[], duplicates: Map<string, DuplicateMatch> | null): ImportCounts {
  const live = drafts.filter((q) => q.reviewStatus !== 'rejected');
  return {
    pages: session.result?.totalPages ?? 0,
    detected: session.result?.report.totalQuestionsDetected ?? drafts.length,
    extracted: live.length,
    answered: live.filter((q) => Boolean(q.correctAnswer)).length,
    solved: live.filter((q) => Boolean(q.stepByStepSolution?.trim() || q.sourceSolutionText?.trim())).length,
    needVerification: live.filter((q) => q.contentStatus !== 'verified' || !isReviewedForExams(q)).length,
    duplicates: duplicates ? live.filter((q) => duplicates.has(q.id)).length : 0,
    approved: live.filter((q) => q.reviewStatus === 'approved').length,
    published: session.publishedIds.length,
  };
}

export const EMPTY_COUNTS: ImportCounts = { pages: 0, detected: 0, extracted: 0, answered: 0, solved: 0, needVerification: 0, duplicates: 0, approved: 0, published: 0 };

export interface ImportTotals extends ImportCounts {
  files: number;
  errors: number;
  inProgress: number;
}

export function totals(sessions: ImportSession[]): ImportTotals {
  const sum = { ...EMPTY_COUNTS, files: sessions.length, errors: 0, inProgress: 0 };
  for (const s of sessions) {
    for (const key of Object.keys(EMPTY_COUNTS) as (keyof ImportCounts)[]) sum[key] += s.counts?.[key] ?? 0;
    if (s.status === 'error' || s.status === 'interrupted') sum.errors += 1;
    if (s.status === 'queued' || s.status === 'extracting' || s.status === 'answering') sum.inProgress += 1;
  }
  return sum;
}

/** A session still marked as running when the app loads was stopped (refresh, closed tab, lost connection). */
export function wasInterrupted(status: ImportStatus): boolean {
  return status === 'queued' || status === 'extracting' || status === 'answering';
}

/** Drafts that still need an AI answer and solution (needs at least two choices). */
export function needsAnswer(q: Question): boolean {
  return q.reviewStatus !== 'rejected' && !q.aiSolution && q.options.length >= 2;
}
