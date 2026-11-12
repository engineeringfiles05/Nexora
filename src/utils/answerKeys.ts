/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeps correct answers away from reviewees until they are allowed to see them.
 *
 * A published question is stored in two documents:
 * - `questions/{id}`: what an examinee needs to sit the exam (text, choices, figures, subject),
 *   readable by active reviewees of the question's course;
 * - `questionKeys/{id}`: the correct answer, explanation, solution and review notes, readable by
 *   the administrator, and by a reviewee only after they have committed their own answer to
 *   that question in `users/{uid}/responses/{id}`, a record they can't change afterwards
 *   (firestore.rules). So a reviewee sees a question's answer only once their answer is
 *   fixed: when they submit an exam, or when instant feedback reveals it in a quiz.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase.ts';
import type { Question } from '../types/index.ts';

/** Everything that gives the answer away, plus the administrator's review notes. */
export const PRIVATE_QUESTION_FIELDS = [
  'correctAnswer',
  'extractedAnswerKey',
  'explanation',
  'stepByStepSolution',
  'formulasUsed',
  'givenValues',
  'finalAnswerWithUnit',
  'aiSolution',
  'sourceSolutionText',
  'extractionIssues',
  'answerSource',
  'flaggedReason',
] as const satisfies readonly (keyof Question)[];

export type PrivateField = (typeof PRIVATE_QUESTION_FIELDS)[number];
export type AnswerKey = Partial<Pick<Question, PrivateField>> & { id: string };
export type PublicQuestion = Omit<Question, PrivateField>;

export function splitQuestion(q: Question): { publicDoc: PublicQuestion; key: AnswerKey } {
  const publicDoc: Record<string, unknown> = { ...q };
  const key: Record<string, unknown> = { id: q.id };
  for (const field of PRIVATE_QUESTION_FIELDS) {
    if (field in publicDoc) {
      if (publicDoc[field] !== undefined) key[field] = publicDoc[field];
      delete publicDoc[field];
    }
  }
  return { publicDoc: publicDoc as PublicQuestion, key: key as AnswerKey };
}

/**
 * The question with its key filled in. Fields the question already carries win: a stored
 * question never has them, so they can only come from an edit that hasn't been saved back yet.
 */
export function mergeKey(q: Question | PublicQuestion, key: AnswerKey | undefined): Question {
  if (!key) return q as Question;
  const { id: _id, ...answer } = key;
  const merged: Record<string, unknown> = { ...answer };
  for (const [field, value] of Object.entries(q)) if (value !== undefined) merged[field] = value;
  return merged as unknown as Question;
}

export function hasPrivateFields(data: Record<string, unknown>): boolean {
  return PRIVATE_QUESTION_FIELDS.some((f) => f in data);
}

/** True when the question already carries its answer (the administrator's merged copy). */
export function hasAnswer(q: Partial<Question>): boolean {
  return typeof q.correctAnswer === 'string';
}

// ---------------------------------------------------------------------------
// Reviewee side
// ---------------------------------------------------------------------------

export interface CommittedAnswer {
  questionId: string;
  /** The choice picked, or "" when the question was left unanswered. */
  answer: string;
  examId: string;
}

/**
 * Records the reviewee's answers. Each record can be created once and never changed (the
 * rules refuse updates), so an answer already recorded for a question, in this or an earlier
 * exam, is simply kept.
 */
export async function commitAnswers(uid: string, answers: CommittedAnswer[]): Promise<void> {
  const answeredAt = new Date().toISOString();
  for (let i = 0; i < answers.length; i += 20) {
    await Promise.all(
      answers.slice(i, i + 20).map(async (a) => {
        const ref = doc(db, 'users', uid, 'responses', a.questionId);
        try {
          await setDoc(ref, { questionId: a.questionId, answer: a.answer.slice(0, 4), examId: a.examId.slice(0, 128), answeredAt });
        } catch (error) {
          // Already answered before (the record can't be overwritten): that's fine as long as it exists.
          const existing = await getDoc(ref).catch(() => null);
          if (!existing?.exists()) throw error;
        }
      })
    );
  }
}

/** Reads the answer keys the reviewee is now allowed to see. */
export async function fetchAnswerKeys(questionIds: string[]): Promise<Map<string, AnswerKey>> {
  const keys = new Map<string, AnswerKey>();
  for (let i = 0; i < questionIds.length; i += 20) {
    const batch = await Promise.all(questionIds.slice(i, i + 20).map((id) => getDoc(doc(db, 'questionKeys', id))));
    for (const snapshot of batch) if (snapshot.exists()) keys.set(snapshot.id, { ...(snapshot.data() as AnswerKey), id: snapshot.id });
  }
  return keys;
}

/**
 * Commits the given answers, then returns the questions with their keys merged in. Questions
 * that already carry their answer (the administrator's copies) are returned as they are.
 */
export async function revealAnswers(uid: string, examId: string, questions: Question[], answers: Record<string, string>): Promise<Question[]> {
  const locked = questions.filter((q) => !hasAnswer(q));
  if (!locked.length) return questions;
  await commitAnswers(
    uid,
    locked.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '', examId }))
  );
  const keys = await fetchAnswerKeys(locked.map((q) => q.id));
  const missing = locked.filter((q) => !keys.has(q.id));
  if (missing.length) {
    throw new Error(`The answers of ${missing.length} question(s) could not be loaded. Check your connection and try again.`);
  }
  return questions.map((q) => (hasAnswer(q) ? q : mergeKey(q, keys.get(q.id))));
}
