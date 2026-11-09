/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Character-level extraction tests. Every question and every choice of every fixture is
 * compared with the exact text that was printed, not a sample.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Question } from '../../src/types/index.ts';
import type { PageImageReader, ReadLine } from './imageReader.ts';
import { runExtraction } from './pipeline.ts';
import * as F from './testFixtures.ts';
import { normalizeSolution } from './solver.ts';

function assertMatchesTruth(questions: Question[], truth: F.TruthQuestion[], label: string) {
  assert.equal(questions.length, truth.length, `${label}: question count`);
  truth.forEach((t, i) => {
    const q = questions[i];
    assert.equal(q.originalQuestionNumber, t.number, `${label}: question order at position ${i + 1}`);
    assert.equal(q.question, t.stem, `${label}: text of question ${t.number}`);
    assert.deepEqual(q.options, t.options, `${label}: choices of question ${t.number}`);
    if (t.answer) assert.equal(q.correctAnswer, t.answer, `${label}: answer of question ${t.number}`);
    if (t.pages) assert.deepEqual(q.sourcePdfPages, t.pages, `${label}: pages of question ${t.number}`);
    // The original reading is kept separately from anything an admin or AI changes later.
    assert.equal(q.originalQuestionText, t.stem);
    assert.deepEqual(q.originalOptions, t.options);
  });
}

test('text-based PDF: exponents, Greek letters, every choice layout, page-spanning question, answer key', async () => {
  const f = await F.textBasedExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'text-based.pdf' });
  assertMatchesTruth(r.questions, f.questions, 'text-based');
  assert.equal(r.totalPages, 2);
  // The requirement's example, exactly.
  assert.equal(
    r.questions[0].question,
    'What is the resistance of a conductor having a resistivity of 1.72 × 10⁻⁸ Ω·m, a length of 100 meters, and a cross-sectional area of 2 mm²?'
  );
  // Headers and page numbers are removed from question text but listed in the report.
  for (const q of r.questions) assert.doesNotMatch(q.question + q.options.map((o) => o.text).join(), /NEXORA ACADEMY|Page \d of/);
  assert.deepEqual(r.report.pages?.[0].removedLines, ['NEXORA ACADEMY - REE PRE-BOARD EXAMINATION', 'Page 1 of 2']);
  // A printed solution is kept verbatim and apart from the question.
  assert.match(r.questions[3].sourceSolutionText ?? '', /^Pout = 25 × 0\.85/);
  assert.equal(r.report.answerKeyFound, true);
  assert.ok(r.questions.every((q) => q.reviewStatus === 'pending' && q.answerSource === 'pdf_key'));
});

test('two-column paper is read column by column', async () => {
  const f = await F.twoColumnExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'two-column.pdf' });
  assertMatchesTruth(r.questions, f.questions, 'two-column');
  assert.deepEqual(r.report.missingQuestionNumbers, []);
});

test('300-question paper: every question and choice exact, page boundaries tracked', async () => {
  const f = await F.largeExam(300);
  const r = await runExtraction({ bytes: f.bytes, filename: 'large.pdf' });
  assertMatchesTruth(r.questions, f.questions, 'large');
  assert.ok(f.questions.filter((q) => q.pages!.length > 1).length > 10, 'fixture must contain questions split across pages');
  assert.equal(r.report.totalQuestionsDetected, 300);
  assert.equal(r.report.totalChoicesDetected, 1200);
});

test('circuit diagram is cropped and attached; its labels do not leak into the question', async () => {
  const f = await F.circuitDiagramExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'circuit.pdf' });
  assertMatchesTruth(r.questions, f.questions, 'circuit');
  const figures = r.questions[0].figures ?? [];
  assert.equal(figures.length, 1);
  assert.equal(figures[0].kind, 'diagram');
  assert.match(figures[0].dataUrl ?? '', /^data:image\/png;base64,/);
  assert.deepEqual(figures[0].labels, ['R1 = 4 Ω', '12 V', 'R2 = 2 Ω']);
  assert.ok(!r.questions[0].extractionIssues?.some((i) => i.code === 'FIGURE_NOT_CAPTURED'));
});

test('scanned PDF without page-image reading fails honestly instead of inventing questions', async () => {
  const f = await F.scannedExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'EE 1 Evaluation Exam.pdf' });
  assert.equal(r.questions.length, 0);
  assert.equal(r.report.overallStatus, 'failed');
  assert.equal(r.report.pages?.[0].status, 'error');
  assert.equal(r.report.pages?.[0].method, 'none');
});

/** Stands in for Gemini: returns what is printed, with optional misreadings. */
function fakeReader(pages: Record<number, string[]>, misread?: (text: string, pass: 1 | 2) => string): PageImageReader {
  return {
    name: 'test reader',
    async read(_png, page, pass): Promise<ReadLine[]> {
      return (pages[page] ?? []).map((text) => ({ kind: 'text', text: misread ? misread(text, pass) : text }));
    },
  };
}

test('scanned PDF: two agreeing readings verify a question; a disagreement is flagged with both readings', async () => {
  const f = await F.scannedExam();
  const reader = fakeReader({ 1: F.SCANNED_TEXT }, (t, pass) => (pass === 2 && t === 'C. ohmmeter' ? 'C. ⟦ohmmeter⟧' : t));
  const r = await runExtraction({ bytes: f.bytes, filename: 'scanned.pdf', reader });
  assertMatchesTruth(r.questions, f.questions, 'scanned');
  const [q1, q2] = r.questions;
  assert.equal(q1.extractionMethod, 'ocr');
  assert.equal(q1.crossCheck, 'agree');
  assert.equal(q1.contentStatus, 'verified');
  assert.equal(q2.crossCheck, 'differ');
  assert.equal(q2.contentStatus, 'needs_review');
  const issue = q2.extractionIssues?.find((i) => i.code === 'READINGS_DIFFER');
  assert.equal(issue?.choiceKey, 'C');
  assert.deepEqual(issue?.readings, { textLayer: 'ohmmeter', pageImage: '⟦ohmmeter⟧' });
  assert.equal(r.report.overallStatus, 'needs_review');
});

test('uncertain characters in a single reading block the question until fixed', async () => {
  const f = await F.scannedExam();
  const reader = fakeReader({ 1: F.SCANNED_TEXT.map((t) => t.replace('ampere', '⟦ampere⟧')) });
  const r = await runExtraction({ bytes: f.bytes, filename: 'scanned.pdf', reader, scannedPasses: 1 });
  const q1 = r.questions[0];
  assert.equal(q1.options[1].text, '⟦ampere⟧');
  assert.equal(q1.contentStatus, 'incomplete');
  assert.ok(q1.extractionIssues?.some((i) => i.code === 'UNREADABLE_TEXT' && i.choiceKey === 'B'));
  assert.ok(q1.extractionIssues?.some((i) => i.code === 'SINGLE_IMAGE_READING'));
});

test('text-layer vs page-image cross-check catches a single-character difference', async () => {
  const f = await F.textBasedExam();
  const plain = await runExtraction({ bytes: f.bytes, filename: 'a.pdf' });
  const printed = Object.fromEntries(plain.pageTexts.map((p) => [p.page, p.text.split('\n')]));
  const reader = fakeReader(printed, (t) => t.replace('Ω·m', 'Ω-m'));
  const r = await runExtraction({ bytes: f.bytes, filename: 'a.pdf', reader });
  assertMatchesTruth(r.questions, f.questions, 'cross-checked'); // the text layer stays authoritative
  assert.equal(r.questions[0].crossCheck, 'differ');
  assert.equal(r.questions[0].extractionIssues?.find((i) => i.code === 'READINGS_DIFFER')?.readings?.pageImage?.includes('Ω-m'), true);
  for (const q of r.questions.slice(1)) {
    assert.equal(q.crossCheck, 'agree');
    assert.equal(q.contentStatus, 'verified');
  }
});

test('defective paper: missing number, missing choices and a short choice set are all reported', async () => {
  const f = await F.defectiveExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'defective.pdf' });
  assert.deepEqual(r.questions.map((q) => q.originalQuestionNumber), [1, 2, 4, 5]);
  assert.deepEqual(r.report.missingQuestionNumbers, [3]);
  assert.equal(r.report.overallStatus, 'incomplete');
  const q4 = r.questions[2];
  const q5 = r.questions[3];
  assert.ok(q4.extractionIssues?.some((i) => i.code === 'FEWER_CHOICES_THAN_USUAL'));
  assert.ok(q5.extractionIssues?.some((i) => i.code === 'CHOICE_MISSING' && i.choiceKey === 'C'));
  assert.equal(q4.contentStatus, 'incomplete');
  assert.equal(q5.contentStatus, 'incomplete');
  // Nothing is filled in: the choices are only what was printed.
  assert.deepEqual(q5.options.map((o) => o.key), ['A', 'B', 'D']);
});

test('without page-image reading nothing is labelled verified', async () => {
  const f = await F.textBasedExam();
  const r = await runExtraction({ bytes: f.bytes, filename: 'a.pdf' });
  assert.equal(r.report.overallStatus, 'needs_review');
  assert.ok(r.questions.every((q) => q.contentStatus !== 'verified'));
  assert.ok(r.report.warnings?.some((w) => /not configured/.test(w)));
});

test('the same file always gets the same source id and fingerprints', async () => {
  const f = await F.textBasedExam();
  const a = await runExtraction({ bytes: f.bytes, filename: 'one.pdf' });
  const b = await runExtraction({ bytes: f.bytes, filename: 'renamed.pdf' });
  assert.equal(a.sourcePdfId, b.sourcePdfId);
  assert.equal(a.documentHash, b.documentHash);
  assert.deepEqual(a.questions.map((q) => q.contentFingerprint), b.questions.map((q) => q.contentFingerprint));
});

test('AI answers outside the choices are discarded instead of kept as a guess', () => {
  const input = { question: 'q', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }] };
  const bad = normalizeSolution({ answerKey: 'E', confidence: 'high', explanation: 'x', stepByStepSolution: 'y' }, input, 'm');
  assert.equal(bad.suggestedAnswer, undefined);
  assert.equal(bad.confidence, 'low');
  const good = normalizeSolution({ answerKey: 'b', confidence: 'high', explanation: 'x', stepByStepSolution: 'y' }, input, 'm');
  assert.equal(good.suggestedAnswer, 'B');
  assert.equal(good.confidence, 'high');
  const unsure = normalizeSolution({ answerKey: '', confidence: 'low', explanation: 'x', stepByStepSolution: 'y' }, input, 'm');
  assert.equal(unsure.suggestedAnswer, undefined);
});
