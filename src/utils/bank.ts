/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { contentCourse } from '../auth/accountStatus.ts';
import type { ExamConfig, ExamResult, ExamType, PdfSource, Question, SubjectId } from '../types/index.ts';

type SourceMode = PdfSource['allowedModes'][number];

/** Only verified or explicitly overridden answers may count toward a score. */
export function isReviewedForExams(question: Pick<Question, 'verificationStatus'>): boolean {
  return question.verificationStatus === 'verified' || question.verificationStatus === 'manual_override';
}

/** Sources list four modes, so the diagnostic maps to practice and PDF sets map to quiz. */
export function examTypeToSourceMode(type: ExamType): SourceMode {
  switch (type) {
    case 'quiz':
    case 'pdf_quiz':
      return 'quiz';
    case 'pre_board':
      return 'preboard';
    case 'final_mock':
      return 'mock';
    case 'pre_test':
    case 'practice':
      return 'practice';
  }
}

export function isSourceAvailableForExam(source: PdfSource, type: ExamType): boolean {
  return source.isPublicToReviewees && source.allowedModes.includes(examTypeToSourceMode(type));
}

export function getSelectableSources(sources: PdfSource[], type: ExamType): PdfSource[] {
  return sources.filter((source) => isSourceAvailableForExam(source, type));
}

/**
 * Imported questions carry a reviewStatus and reach reviewees only once an admin approved
 * them against the PDF. Questions authored before the strict importer have none.
 */
export function isApprovedForReviewees(question: Pick<Question, 'reviewStatus'>): boolean {
  return question.reviewStatus === undefined || question.reviewStatus === 'approved';
}

export function isQuestionEligibleForExam(question: Question, type: ExamType, sources: PdfSource[]): boolean {
  if (!question.isPublished || !isReviewedForExams(question) || !isApprovedForReviewees(question)) return false;
  if (!question.sourcePdfId) return true; // manually authored questions have no source
  const source = sources.find((item) => item.id === question.sourcePdfId);
  return source ? isSourceAvailableForExam(source, type) : false;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export type ExamSelection = { ok: true; questions: Question[] } | { ok: false; error: string };

/** Launcher defaults per mode. The dashboard cards and the launcher both read these. */
export const EXAM_MODE_DEFAULTS: Record<ExamType, { questionCount: number; durationMinutes: number; instantFeedback: boolean }> = {
  pre_test: { questionCount: 12, durationMinutes: 30, instantFeedback: false },
  quiz: { questionCount: 10, durationMinutes: 15, instantFeedback: true },
  practice: { questionCount: 15, durationMinutes: 30, instantFeedback: false },
  pre_board: { questionCount: 20, durationMinutes: 45, instantFeedback: false },
  final_mock: { questionCount: 20, durationMinutes: 60, instantFeedback: false },
  pdf_quiz: { questionCount: 15, durationMinutes: 30, instantFeedback: false },
};

/** Builds an exam, or explains why it can't. Never widens filters to avoid an empty exam. */
export function selectExamQuestions(
  questions: Question[],
  sources: PdfSource[],
  config: ExamConfig,
  random: () => number = Math.random
): ExamSelection {
  if (config.type === 'pdf_quiz' || config.pdfSourceId) {
    const source = sources.find((item) => item.id === config.pdfSourceId);
    if (!source) {
      return { ok: false, error: 'Please select an available PDF question set.' };
    }
    if (!isSourceAvailableForExam(source, config.type)) {
      return { ok: false, error: `"${source.filename}" is not available for this examination mode.` };
    }
  }

  let pool = questions.filter((q) => isQuestionEligibleForExam(q, config.type, sources));
  if (config.pdfSourceId) {
    pool = pool.filter((q) => q.sourcePdfId === config.pdfSourceId);
  }
  if (config.subjectId && config.subjectId !== 'all') {
    pool = pool.filter((q) => q.subjectId === config.subjectId);
  }
  if (config.topic && config.topic !== 'all') {
    pool = pool.filter((q) => q.topic.toLowerCase() === config.topic?.toLowerCase());
  }
  if (config.difficulty && config.difficulty !== 'mixed') {
    pool = pool.filter((q) => q.difficulty === config.difficulty);
  }

  if (pool.length === 0) {
    return {
      ok: false,
      error: 'No published, reviewed questions match these settings. Try a different subject, topic, difficulty or source.',
    };
  }

  // Never quietly run a shorter exam than the one requested.
  if (pool.length < config.questionCount) {
    return {
      ok: false,
      error: `Only ${pool.length} published, reviewed question${pool.length === 1 ? ' matches' : 's match'} these settings, but ${config.questionCount} were requested. Choose ${pool.length} or fewer questions, or widen the subject, topic or difficulty.`,
    };
  }

  let selected = config.randomizeQuestions ? shuffled(pool, random) : pool;
  selected = selected.slice(0, config.questionCount);
  if (config.randomizeChoices) {
    selected = selected.map((q) => ({ ...q, options: shuffled(q.options, random) }));
  }
  return { ok: true, questions: selected };
}

/** A result's own snapshot wins, so later bank edits and deletes can't change a past review. */
export function getReviewQuestions(result: ExamResult, bank: Question[]): Question[] {
  if (result.questionSnapshots && result.questionSnapshots.length > 0) {
    return result.questionSnapshots;
  }
  // Results saved before snapshots existed: only answered or flagged questions can be recovered.
  const matched = bank.filter(
    (q) => result.userAnswers[q.id] !== undefined || result.flaggedQuestionIds.includes(q.id)
  );
  return matched.length > 0 ? matched : bank.slice(0, result.totalQuestions);
}

/** Recomputes a source's counts from the questions that actually reference it. */
export function reconcileSourceCounts(source: PdfSource, questions: Question[]): PdfSource {
  const own = questions.filter((q) => q.sourcePdfId === source.id);
  const reviewed = own.filter(isReviewedForExams).length;
  const subjectIds: SubjectId[] = ['math', 'esas', 'ee'];
  return {
    ...source,
    questionsCount: own.length,
    verifiedCount: reviewed,
    needsReviewCount: own.length - reviewed,
    subjectCoverage: subjectIds
      .map((subjectId) => ({ subjectId, count: own.filter((q) => q.subjectId === subjectId).length }))
      .filter((entry) => entry.count > 0),
  };
}

/**
 * Publishes staged questions. Reimporting a filename keeps that source's ID and settings,
 * and counts are derived from the bank so partial publishes add up.
 */
/** Bank questions that already hold the same text and choices (same fingerprint). */
export function findBankDuplicates(bank: Question[], incoming: Question[]): Map<string, Question> {
  const byFingerprint = new Map<string, Question>();
  for (const q of bank) if (q.contentFingerprint) byFingerprint.set(q.contentFingerprint, q);
  const duplicates = new Map<string, Question>();
  for (const q of incoming) {
    const match = q.contentFingerprint ? byFingerprint.get(q.contentFingerprint) : undefined;
    if (match) duplicates.set(q.id, match);
  }
  return duplicates;
}

/**
 * Publishes staged questions. Reimporting a filename or the same file under another name
 * keeps that source's ID and settings, counts are derived from the bank so partial publishes
 * add up, and questions whose text and choices are already in the bank are skipped.
 */
export function publishQuestionsToBank(
  questions: Question[],
  sources: PdfSource[],
  incoming: Question[],
  incomingSource: PdfSource
): { questions: Question[]; sources: PdfSource[]; skipped: Question[] } {
  const existing = sources.find(
    (source) =>
      source.id === incomingSource.id ||
      source.filename === incomingSource.filename ||
      (Boolean(incomingSource.fileHash) && source.fileHash === incomingSource.fileHash)
  );
  const source: PdfSource = existing
    ? { ...existing, status: 'published', ...(incomingSource.fileHash ? { fileHash: incomingSource.fileHash } : {}) }
    : { ...incomingSource, course: contentCourse(incomingSource) };
  const duplicates = findBankDuplicates(questions, incoming);
  const seen = new Set<string>();
  const skipped: Question[] = [];
  const fresh = incoming.filter((q) => {
    const key = q.contentFingerprint;
    if (duplicates.has(q.id) || (key && seen.has(key))) {
      skipped.push(q);
      return false;
    }
    if (key) seen.add(key);
    return true;
  });
  const published = fresh.map((q) => ({
    ...q,
    isPublished: true,
    sourcePdfId: source.id,
    sourcePdfName: source.filename,
    // Questions follow their question set's course (firestore.rules restricts reviewees to it).
    course: contentCourse(source),
  }));
  const nextQuestions = [...questions, ...published];
  const reconciled = reconcileSourceCounts(source, nextQuestions);
  return {
    questions: nextQuestions,
    sources: existing
      ? sources.map((item) => (item.id === existing.id ? reconciled : item))
      : [reconciled, ...sources],
    skipped,
  };
}

const canPublish = (q: Question) => isReviewedForExams(q) && isApprovedForReviewees(q);

/** Uncertain answers and unapproved imports start unselected and stay until an admin approves them. */
export function getDefaultSelectedIds(staged: Question[]): string[] {
  return staged.filter(canPublish).map((q) => q.id);
}

export function splitPublishableQuestions(
  staged: Question[],
  selectedIds: string[]
): { publishable: Question[]; held: Question[] } {
  const selected = staged.filter((q) => selectedIds.includes(q.id));
  return {
    publishable: selected.filter(canPublish),
    held: selected.filter((q) => !canPublish(q)),
  };
}
