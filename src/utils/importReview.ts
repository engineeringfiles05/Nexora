/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin review actions on staged questions. Pure functions, so the rules are testable:
 * - approval needs readable text; remaining issues are acknowledged, not deleted;
 * - an AI solution is stored beside the question and never changes its text or choices;
 * - an AI answer is used only when the AI is confident and the PDF gives no answer.
 */

import type { AiSolution, ExtractionIssue, Question } from '../types/index.ts';
import { SUBJECT_NAMES, hasUnreadableText, openIssues, refreshQuestionAssessment, revalidateEditedQuestion } from './questionExtractor.ts';

export function approvalBlocker(q: Question): string | null {
  if (!q.question.trim()) return 'The question has no text.';
  if (q.options.length < 2) return 'The question needs at least two choices.';
  if (hasUnreadableText(q.question) || q.options.some((o) => hasUnreadableText(o.text))) {
    return 'Some text was not read with certainty (⟦ ⟧ or �). Edit it to match the PDF first.';
  }
  return null;
}

/** Issues the admin is confirming by approving. */
export function issuesToConfirm(q: Question): ExtractionIssue[] {
  return openIssues(q).filter((i) => i.severity !== 'info');
}

export function approveQuestion(q: Question, now = new Date().toISOString()): Question {
  const blocker = approvalBlocker(q);
  if (blocker) throw new Error(blocker);
  return refreshQuestionAssessment({
    ...q,
    extractionIssues: (q.extractionIssues ?? []).map((i) => (i.severity === 'info' ? i : { ...i, acknowledged: true })),
    reviewStatus: 'approved',
    reviewedAt: now,
  });
}

export function rejectQuestion(q: Question, now = new Date().toISOString()): Question {
  return refreshQuestionAssessment({ ...q, reviewStatus: 'rejected', reviewedAt: now });
}

export function reopenQuestion(q: Question): Question {
  return refreshQuestionAssessment({
    ...q,
    reviewStatus: 'pending',
    reviewedAt: undefined,
    extractionIssues: (q.extractionIssues ?? []).map(({ acknowledged: _ack, ...rest }) => rest),
  });
}

export function setAnswer(q: Question, key: string): Question {
  const fromPdf = Boolean(key) && key === q.extractedAnswerKey;
  return revalidateEditedQuestion({
    ...q,
    correctAnswer: key,
    answerSource: !key ? 'none' : fromPdf ? 'pdf_key' : 'admin',
    verificationStatus: !key ? 'needs_verification' : fromPdf ? 'verified' : 'manual_override',
  });
}

/** Saves an admin edit; content checks re-run, and approval is withdrawn if the text changed. */
export function saveEdit(previous: Question, edited: Question): Question {
  const contentChanged =
    previous.question !== edited.question || JSON.stringify(previous.options) !== JSON.stringify(edited.options);
  const next: Question = {
    ...edited,
    updatedAt: new Date().toISOString(),
    ...(contentChanged && previous.reviewStatus === 'approved' ? { reviewStatus: 'pending' as const, reviewedAt: undefined } : {}),
  };
  return revalidateEditedQuestion(next);
}

export function applyAiSolution(q: Question, s: AiSolution): Question {
  const issues = (q.extractionIssues ?? []).filter((i) => i.code !== 'AI_DISAGREES' && i.code !== 'AI_UNSURE');
  const next: Question = {
    ...q,
    aiSolution: s,
    // Explanations are not original content; a solution printed in the PDF stays first.
    explanation: q.sourceSolutionText ? q.sourceSolutionText : s.explanation,
    stepByStepSolution: s.stepByStepSolution,
    formulasUsed: s.formulasUsed,
    givenValues: s.givenValues,
    finalAnswerWithUnit: s.finalAnswerWithUnit,
    ...(s.difficulty ? { difficulty: s.difficulty } : {}),
    ...(s.subjectId && q.topic === 'Unclassified' ? { subjectId: s.subjectId, subjectName: SUBJECT_NAMES[s.subjectId] } : {}),
    ...(s.topic && q.topic === 'Unclassified' ? { topic: s.topic } : {}),
    extractionIssues: issues,
  };

  const pdfKey = q.answerSource === 'pdf_key' ? q.correctAnswer : undefined;
  if (pdfKey) {
    if (s.suggestedAnswer && s.suggestedAnswer !== pdfKey) {
      next.verificationStatus = 'discrepancy_flagged';
      issues.push({
        code: 'AI_DISAGREES',
        severity: 'info',
        field: 'answer',
        message: `The PDF gives ${pdfKey}, but AI worked out ${s.suggestedAnswer} (${s.confidence} confidence). Check the solution and set the answer.`,
      });
    }
    return refreshQuestionAssessment(next);
  }
  if (q.answerSource === 'admin') {
    if (s.suggestedAnswer && s.suggestedAnswer !== q.correctAnswer) {
      issues.push({ code: 'AI_DISAGREES', severity: 'info', field: 'answer', message: `AI worked out ${s.suggestedAnswer}; your answer is ${q.correctAnswer}.` });
    }
    return refreshQuestionAssessment(next);
  }
  if (s.suggestedAnswer && s.confidence === 'high') {
    next.correctAnswer = s.suggestedAnswer;
    next.answerSource = 'ai';
    next.verificationStatus = 'verified';
  } else {
    next.correctAnswer = '';
    next.answerSource = 'none';
    next.verificationStatus = 'needs_verification';
    issues.push({
      code: 'AI_UNSURE',
      severity: 'info',
      field: 'answer',
      message: s.suggestedAnswer
        ? `AI suggests ${s.suggestedAnswer} with only ${s.confidence} confidence, so the answer needs verification.`
        : 'AI could not determine the answer confidently, so it needs verification.',
    });
  }
  return refreshQuestionAssessment(next);
}

/**
 * "Regenerate solution": keeps the answer the question already has and only replaces the
 * explanation and working. If the AI's working reaches another choice, that is flagged.
 */
export function applySolutionOnly(q: Question, s: AiSolution): Question {
  const issues = (q.extractionIssues ?? []).filter((i) => i.code !== 'AI_DISAGREES' && i.code !== 'AI_UNSURE');
  if (q.correctAnswer && s.suggestedAnswer && s.suggestedAnswer !== q.correctAnswer) {
    issues.push({
      code: 'AI_DISAGREES',
      severity: 'info',
      field: 'answer',
      message: `The regenerated working reaches ${s.suggestedAnswer}, not ${q.correctAnswer} (${s.confidence} confidence). Check the answer.`,
    });
  }
  return refreshQuestionAssessment({
    ...q,
    aiSolution: s,
    explanation: q.sourceSolutionText ? q.sourceSolutionText : s.explanation,
    stepByStepSolution: s.stepByStepSolution,
    formulasUsed: s.formulasUsed,
    givenValues: s.givenValues,
    finalAnswerWithUnit: s.finalAnswerWithUnit,
    extractionIssues: issues,
  });
}

export function newManualQuestion(number: number, page: number, sourcePdfId: string, sourcePdfName: string, documentHash?: string): Question {
  const now = new Date().toISOString();
  return {
    id: `ext-manual-${Date.now().toString(36)}`,
    originalQuestionNumber: number,
    question: '',
    options: ['A', 'B', 'C', 'D'].map((key) => ({ key, text: '' })),
    correctAnswer: '',
    explanation: '',
    subjectId: 'ee',
    subjectName: SUBJECT_NAMES.ee,
    topic: 'Unclassified',
    difficulty: 'Average',
    sourcePdfId,
    sourcePdfName,
    sourcePdfPage: page,
    sourcePdfPages: [page],
    ...(documentHash ? { sourceDocumentHash: documentHash } : {}),
    extractionMethod: 'manual',
    extractionIssues: [{ code: 'ENTERED_MANUALLY', severity: 'info', message: 'Typed in by an administrator from the PDF.' }],
    crossCheck: 'not_run',
    contentStatus: 'needs_review',
    reviewStatus: 'pending',
    answerSource: 'none',
    verificationStatus: 'needs_verification',
    extractionConfidence: 100,
    isPublished: false,
    createdAt: now,
    updatedAt: now,
  };
}
