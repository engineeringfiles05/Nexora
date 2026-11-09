/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractionReport, parseQuestionLines, stageParsedQuestions, textToSourceLines } from './questionExtractor.ts';
import { applyAiSolution, approveQuestion, approvalBlocker, saveEdit, setAnswer } from './importReview.ts';
import { getDefaultSelectedIds, isQuestionEligibleForExam, publishQuestionsToBank, splitPublishableQuestions } from './bank.ts';
import type { AiSolution, PdfSource, Question } from '../types/index.ts';

const parse = (text: string) => parseQuestionLines(textToSourceLines(text));
const stage = (text: string) =>
  stageParsedQuestions(parse(text).questions, { sourcePdfId: 'pdf-x', sourcePdfName: 'x.pdf', method: 'text', now: '2026-01-01T00:00:00Z' });

test('text is kept exactly: symbols, units, spacing inside lines, odd spellings', () => {
  const doc = parse(
    '7. A 10 kVA, 2400/240-V transformr has Z = 3.2∠75° Ω and I₁ = 4.17 A;  find Vreg (±0.5%).\nA. 2.1%\nB. 2.5 %\nC. −1.3%\nD. 3.0%'
  );
  const q = doc.questions[0];
  assert.equal(q.stem, 'A 10 kVA, 2400/240-V transformr has Z = 3.2∠75° Ω and I₁ = 4.17 A;  find Vreg (±0.5%).');
  assert.deepEqual(q.options.map((o) => o.text), ['2.1%', '2.5 %', '−1.3%', '3.0%']);
});

test('numbered instructions before question 1 are not taken as questions', () => {
  const doc = parse('INSTRUCTIONS\n1. Write your name.\n2. Use a pencil.\n1. What is 1 + 1?\nA. 1\nB. 2\nC. 3\nD. 4');
  assert.equal(doc.questions.length, 1);
  assert.equal(doc.questions[0].stem, 'What is 1 + 1?');
  assert.match(doc.preamble, /Write your name/);
});

test('"A.C." and decimals at a line start are not mistaken for choices or numbers', () => {
  const doc = parse('1. In an\nA.C. circuit the current leads by\n1.5 radians when the load is:\nA. inductive\nB. capacitive\nC. resistive\nD. none');
  assert.equal(doc.questions.length, 1);
  assert.equal(doc.questions[0].stem, 'In an A.C. circuit the current leads by 1.5 radians when the load is:');
  assert.equal(doc.questions[0].options.length, 4);
});

test('inline, grid, parenthesised and lowercase choices', () => {
  const doc = parse(
    [
      '1. One?',
      'A. 5 A\tB. 6 A\tC. 7 A\tD. 8 A',
      '2. Two?',
      'A. x\tC. z',
      'B. y\tD. w',
      '3. Three? (A) mass (B) speed (C) velocity (D) time',
      '4. Four?',
      'a) alpha',
      'b) beta',
      'c) gamma',
      'd) delta',
    ].join('\n')
  );
  assert.deepEqual(doc.questions.map((q) => q.options.map((o) => `${o.key}:${o.text}`).join(' ')), [
    'A:5 A B:6 A C:7 A D:8 A',
    'A:x B:y C:z D:w',
    'A:mass B:speed C:velocity D:time',
    'A:alpha B:beta C:gamma D:delta',
  ]);
  assert.equal(doc.questions[2].stem, 'Three?');
  assert.ok(doc.questions[2].issues.some((i) => i.code === 'CHOICES_INSIDE_STEM'));
});

test('answer keys: inline, trailing, marked and answer-key section; conflicts are flagged', () => {
  const doc = parse(
    [
      '1. One?',
      'A. a',
      'B. b',
      'Answer: B',
      '2. Two?',
      'A. a',
      'B. b   Ans: A',
      '3. Three?',
      'A. a',
      '*B. b',
      '4. Four?',
      'A. a',
      'B. b',
      'Answer: A',
      'ANSWER KEY',
      '1. B  2. A  3. B  4. B  5. A',
    ].join('\n')
  );
  const [q1, q2, q3, q4] = doc.questions;
  assert.equal(q1.inlineAnswerKey, 'B');
  assert.equal(q2.inlineAnswerKey, 'A');
  assert.equal(q2.options[1].text, 'b'); // "Ans: A" is not left inside choice B
  assert.equal(q3.markedAnswerKey, 'B');
  assert.equal(q4.sectionAnswerKey, 'B');
  assert.ok(q4.issues.some((i) => i.code === 'CONFLICTING_ANSWER_KEYS'));
  assert.ok(doc.issues.some((i) => i.code === 'ANSWER_KEY_UNMATCHED'));
});

test('printed solutions are separated from the last choice and kept verbatim', () => {
  const doc = parse('1. Find I.\nA. 1 A\nB. 2 A\nSolution: I = V/R\n= 12/6 = 2 A\n2. Next?\nA. a\nB. b');
  assert.equal(doc.questions[0].options[1].text, '2 A');
  assert.equal(doc.questions[0].solutionText, 'I = V/R = 12/6 = 2 A');
  assert.equal(doc.questions.length, 2);
});

test('a numbered list inside a question stays inside it', () => {
  const doc = parse('5. Which statements are true?\n1) Ohm\n2) Kirchhoff\nA. 1 only\nB. 2 only\nC. both\nD. neither\n6. Next?\nA. a\nB. b\nC. c\nD. d');
  assert.deepEqual(doc.questions.map((q) => q.number), [5, 6]);
  assert.match(doc.questions[0].stem, /1\) Ohm\n2\) Kirchhoff/);
});

test('numbering restarts start a new part, and gaps are reported per part', () => {
  const doc = parse('1. a?\nA. x\nB. y\n2. b?\nA. x\nB. y\nPART II\n1. c?\nA. x\nB. y\n3. d?\nA. x\nB. y');
  assert.deepEqual(doc.questions.map((q) => `${q.section}:${q.number}`), ['0:1', '0:2', '1:1', '1:3']);
  assert.ok(doc.issues.some((i) => i.code === 'MISSING_NUMBERS' && /2/.test(i.message)));
});

test('duplicate choice letters keep the extra text visible and block the question', () => {
  const doc = parse('1. Q?\nA. a\nB. b\nC. c\nD. d\nA. stray\nB. stray2');
  const q = doc.questions[0];
  assert.deepEqual(q.options.map((o) => o.text), ['a', 'b', 'c', 'd']);
  assert.ok(q.issues.some((i) => i.code === 'DUPLICATE_CHOICE_KEY' && /stray/.test(i.message)));
  assert.match(q.rawText, /A\. stray/);
});

test('report never says verified just because extraction finished', () => {
  const qs = stage('1. One?\nA. a\nB. b\nAnswer: A');
  const report = buildExtractionReport({ filename: 'x', totalPages: 1, questions: qs, engineUsed: 't' });
  assert.equal(report.overallStatus, 'needs_review');
  const approved = qs.map((q) => approveQuestion(q));
  assert.equal(buildExtractionReport({ filename: 'x', totalPages: 1, questions: approved, engineUsed: 't' }).overallStatus, 'verified');
  assert.equal(buildExtractionReport({ filename: 'x', totalPages: 1, questions: [], engineUsed: 't' }).overallStatus, 'failed');
});

test('approval: blocked by unreadable text, withdrawn when the text is edited', () => {
  const [q] = stage('1. Value is ⟦1.72⟧ Ω?\nA. a\nB. b');
  assert.match(approvalBlocker(q) ?? '', /not read with certainty/);
  assert.throws(() => approveQuestion(q));
  const fixed = saveEdit(q, { ...q, question: 'Value is 1.72 Ω?' });
  assert.equal(approvalBlocker(fixed), null);
  const approved = approveQuestion(fixed);
  assert.equal(approved.reviewStatus, 'approved');
  assert.equal(approved.originalQuestionText, 'Value is ⟦1.72⟧ Ω?'); // the extracted original is kept
  const reedited = saveEdit(approved, { ...approved, question: 'Value is 1.73 Ω?' });
  assert.equal(reedited.reviewStatus, 'pending');
});

const solution = (over: Partial<AiSolution>): AiSolution => ({
  confidence: 'high',
  explanation: 'e',
  stepByStepSolution: 's',
  formulasUsed: [],
  givenValues: [],
  finalAnswerWithUnit: '',
  model: 'm',
  generatedAt: 'now',
  ...over,
});

test('AI never edits the question; it answers only when confident and the PDF has no key', () => {
  const [noKey] = stage('1. Q?\nA. a\nB. b');
  const confident = applyAiSolution(noKey, solution({ suggestedAnswer: 'B' }));
  assert.equal(confident.question, noKey.question);
  assert.deepEqual(confident.options, noKey.options);
  assert.equal(confident.correctAnswer, 'B');
  assert.equal(confident.answerSource, 'ai');

  const unsure = applyAiSolution(noKey, solution({ suggestedAnswer: 'B', confidence: 'medium' }));
  assert.equal(unsure.correctAnswer, '');
  assert.equal(unsure.verificationStatus, 'needs_verification');

  const [withKey] = stage('1. Q?\nA. a\nB. b\nAnswer: A');
  const disagree = applyAiSolution(withKey, solution({ suggestedAnswer: 'B' }));
  assert.equal(disagree.correctAnswer, 'A'); // the PDF's answer is not overwritten
  assert.equal(disagree.verificationStatus, 'discrepancy_flagged');
  assert.equal(setAnswer(disagree, 'A').verificationStatus, 'verified');
});

const source = (over: Partial<PdfSource> = {}): PdfSource => ({
  id: 'pdf-x',
  filename: 'x.pdf',
  originalName: 'x.pdf',
  fileSize: '1 KB',
  pageCount: 1,
  uploadDate: '2026-01-01',
  status: 'published',
  questionsCount: 0,
  verifiedCount: 0,
  needsReviewCount: 0,
  subjectCoverage: [],
  isPublicToReviewees: true,
  allowedModes: ['quiz', 'practice', 'preboard', 'mock'],
  ...over,
});

test('only approved imports with a reviewed answer can be published or enter an exam', () => {
  const [pending] = stage('1. Q?\nA. a\nB. b\nAnswer: A');
  const approved = approveQuestion(pending);
  assert.deepEqual(getDefaultSelectedIds([pending, approved]), [approved.id]);
  const { publishable, held } = splitPublishableQuestions([pending, approved], [pending.id, approved.id]);
  assert.deepEqual(publishable, [approved]);
  assert.deepEqual(held, [pending]);
  const live = (q: Question) => ({ ...q, isPublished: true });
  assert.equal(isQuestionEligibleForExam(live(pending), 'practice', [source()]), false);
  assert.equal(isQuestionEligibleForExam(live(approved), 'practice', [source()]), true);
});

test('uploading the same PDF again does not duplicate questions, even under another name', () => {
  const qs = stage('1. Q?\nA. a\nB. b\nAnswer: A').map((q) => approveQuestion(q));
  const first = publishQuestionsToBank([], [], qs, source({ fileHash: 'h1' }));
  assert.equal(first.questions.length, 1);
  const again = stage('1. Q?\nA. a\nB. b\nAnswer: A').map((q) => approveQuestion(q));
  const second = publishQuestionsToBank(first.questions, first.sources, again, source({ id: 'pdf-other', filename: 'renamed.pdf', fileHash: 'h1' }));
  assert.equal(second.questions.length, 1);
  assert.equal(second.skipped.length, 1);
  assert.equal(second.sources.length, 1);
});

test('question 1 with its own "1) 2)" list is not mistaken for numbered instructions', () => {
  const doc = parse('1. Which are true?\n1) Ohm\n2) Kirchhoff\nA. 1 only\nB. both\n2. Next?\nA. a\nB. b');
  assert.deepEqual(doc.questions.map((q) => q.number), [1, 2]);
  assert.match(doc.questions[0].stem, /1\) Ohm/);
  const instr = parse('DIRECTIONS\n1. Shade the circle.\n1. Real question?\nA. a\nB. b');
  assert.deepEqual(instr.questions.map((q) => q.stem), ['Real question?']);
});
