/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

export function isQuestionEligibleForExam(question: Question, type: ExamType, sources: PdfSource[]): boolean {
  if (!question.isPublished || !isReviewedForExams(question)) return false;
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
export function publishQuestionsToBank(
  questions: Question[],
  sources: PdfSource[],
  incoming: Question[],
  incomingSource: PdfSource
): { questions: Question[]; sources: PdfSource[] } {
  const existing = sources.find(
    (source) => source.id === incomingSource.id || source.filename === incomingSource.filename
  );
  const source: PdfSource = existing ? { ...existing, status: 'published' } : incomingSource;
  const published = incoming.map((q) => ({
    ...q,
    isPublished: true,
    sourcePdfId: source.id,
    sourcePdfName: source.filename,
  }));
  const nextQuestions = [...questions, ...published];
  const reconciled = reconcileSourceCounts(source, nextQuestions);
  return {
    questions: nextQuestions,
    sources: existing
      ? sources.map((item) => (item.id === existing.id ? reconciled : item))
      : [reconciled, ...sources],
  };
}

/** Uncertain answers start unselected and stay in the queue until an admin approves them. */
export function getDefaultSelectedIds(staged: Question[]): string[] {
  return staged.filter(isReviewedForExams).map((q) => q.id);
}

export function splitPublishableQuestions(
  staged: Question[],
  selectedIds: string[]
): { publishable: Question[]; held: Question[] } {
  const selected = staged.filter((q) => selectedIds.includes(q.id));
  return {
    publishable: selected.filter(isReviewedForExams),
    held: selected.filter((q) => !isReviewedForExams(q)),
  };
}
