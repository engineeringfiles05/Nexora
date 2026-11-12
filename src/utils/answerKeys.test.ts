/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Correct answers stay away from reviewees until they have answered: answers live in an
 * admin-only key document that a reviewee can read only after committing their own answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INITIAL_QUESTIONS } from '../data/seedData.ts';
import type { Question } from '../types/index.ts';
import { PRIVATE_QUESTION_FIELDS, hasAnswer, hasPrivateFields, mergeKey, revealAnswers, splitQuestion } from './answerKeys.ts';
import { calculateExamScore } from './examEngine.ts';

const full = INITIAL_QUESTIONS[0]!;

test('a question splits into a public part without anything that gives the answer away, and its key', () => {
  const { publicDoc, key } = splitQuestion(full);
  for (const field of PRIVATE_QUESTION_FIELDS) assert.equal(field in publicDoc, false, field);
  assert.equal(hasPrivateFields(publicDoc as Record<string, unknown>), false);
  assert.equal(key.id, full.id);
  assert.equal(key.correctAnswer, full.correctAnswer);
  assert.equal(key.explanation, full.explanation);
  // What an examinee needs is still there.
  assert.equal(publicDoc.question, full.question);
  assert.deepEqual(publicDoc.options, full.options);
  assert.equal(publicDoc.verificationStatus, full.verificationStatus);
  assert.equal(hasAnswer(publicDoc), false);
  // Merging the key back gives the whole question again.
  assert.deepEqual(mergeKey(publicDoc, key), full);
});

test('an unsaved edit on the administrator’s copy wins over the stored key', () => {
  const { key } = splitQuestion(full);
  const edited = { ...full, explanation: 'edited, not saved yet' } as Question;
  assert.equal(mergeKey(edited, key).explanation, 'edited, not saved yet');
});

test('questions that already carry their answer are scored without fetching anything', async () => {
  const questions = INITIAL_QUESTIONS.slice(0, 3);
  // No Firestore access happens for the administrator's merged copies.
  assert.deepEqual(await revealAnswers('admin', 'exam-1', questions, {}), questions);
  const publicOnly = questions.map((q) => splitQuestion(q).publicDoc as Question);
  // Without keys the engine can't score anything as correct.
  const blind = calculateExamScore(publicOnly as any, { [questions[0]!.id]: questions[0]!.correctAnswer });
  assert.equal(blind.correctCount, 0);
});

test('firestore.rules: answers never sit in /questions, and keys open only after answering', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  // The rules' list of answer fields is exactly the app's.
  const list = /function answerFields\(\) \{\s*return \[([\s\S]*?)\];/.exec(rules)?.[1] ?? '';
  const fields = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(fields, [...PRIVATE_QUESTION_FIELDS].sort());

  const questions = /match \/questions\/\{questionId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
  assert.match(questions, /allow create, update: if isAdmin\(\) && isValidId\(questionId\) && !incoming\(\)\.keys\(\)\.hasAny\(answerFields\(\)\);/);

  const keys = /match \/questionKeys\/\{questionId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
  assert.match(keys, /allow list: if isAdmin\(\);/);
  assert.match(keys, /allow write: if isAdmin\(\) && isValidId\(questionId\);/);
  assert.match(keys, /isActiveReviewee\(\) &&\s*exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\/responses\/\$\(questionId\)\)/);
  assert.match(keys, /get\(questionPath\(questionId\)\)\.data\.isPublished == true/);
  assert.match(keys, /get\(questionPath\(questionId\)\)\.data\.course == myCourse\(\)/);

  // A committed answer is the reviewee's own, written once and never changed.
  const responses = /match \/responses\/\{questionId\} \{([\s\S]*?)\n      \}/.exec(rules)?.[1] ?? '';
  assert.match(responses, /allow create: if isSignedIn\(\) && request\.auth\.uid == userId/);
  assert.match(responses, /incoming\(\)\.keys\(\)\.hasOnly\(\['questionId', 'answer', 'examId', 'answeredAt'\]\)/);
  assert.match(responses, /allow update: if false;/);
  assert.match(responses, /allow delete: if isAdmin\(\);/);
});

test('every question write splits the answer out, and old questions are migrated first', async () => {
  const sync = await readFile(new URL('./firebaseSync.ts', import.meta.url), 'utf8');
  for (const fn of ['saveQuestionToFirestore', 'batchSaveQuestionsToFirestore', 'seedInitialFirestoreData']) {
    const body = new RegExp(`export async function ${fn}[\\s\\S]*?\\n}\\n`).exec(sync)?.[0] ?? '';
    assert.match(body, /splitQuestion\(/, fn);
    assert.match(body, /'questionKeys'/, fn);
  }
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /\.then\(\(\) => migrateAnswerKeys\(\)\)\s*\.then\(\(\) => backfillContentCourse\(\)\)/);
  // Scores come from questions whose keys were fetched after the answers were committed.
  assert.match(app, /revealedQuestions = await revealAnswers\(currentUser\.id,/);
  assert.match(app, /calculateExamScore\(revealedQuestions, userAnswers\)/);
  assert.match(app, /questionSnapshots: revealedQuestions/);
});

test('instant feedback records the answer before showing it, and locks the choice', async () => {
  const view = await readFile(new URL('../components/ActiveExamView.tsx', import.meta.url), 'utf8');
  assert.match(view, /if \(config\.instantFeedback && \(revealedIds\.includes\(currentQuestion\.id\) \|\| revealing === currentQuestion\.id\)\) return;/);
  assert.match(view, /await onRevealAnswer\(question, key\)/);
  assert.match(view, /currentSelected && revealedIds\.includes\(currentQuestion\.id\) && \(/);
});
