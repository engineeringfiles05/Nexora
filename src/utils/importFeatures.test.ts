/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { INITIAL_PDF_SOURCES, INITIAL_QUESTIONS } from '../data/seedData.ts';
import { EXAM_PROGRAMS, programById } from '../data/programs.ts';
import type { Question } from '../types/index.ts';
import { findDuplicates, publishQuestionsToBank } from './bank.ts';
import { formatStructuredSolution, parseSolutionSections } from './solutionFormat.ts';
import { applySolutionOnly } from './importReview.ts';
import { computeCounts, needsAnswer, prepareDrafts, storableResult, totals, wasInterrupted, EMPTY_COUNTS, type ImportSession } from './importSessions.ts';
import { normalizeSolution } from '../../server/extraction/solver.ts';
import { ImportDashboard } from '../components/importer/ImportDashboard.tsx';
import { ImportQueueList } from '../components/importer/ImportQueueList.tsx';
import { ImportUploader } from '../components/importer/ImportUploader.tsx';
import { SolutionDialog } from '../components/PdfImporterView.tsx';

const base = INITIAL_QUESTIONS[0]!;
const q = (over: Partial<Question>): Question => ({ ...base, ...over });
const options = [
  { key: 'A', text: '10 ohms' },
  { key: 'B', text: '20 ohms' },
  { key: 'C', text: '30 ohms' },
  { key: 'D', text: '40 ohms' },
];
const stem = 'A resistor draws 2 A from a 20 V supply. What is the resistance of the resistor in the circuit?';

// ---- Duplicates ----

test('exact and near duplicates are found; different numbers mean a different problem', () => {
  const bank = [q({ id: 'bank-1', question: stem, options, contentFingerprint: 'fp-1' })];
  const incoming = [
    q({ id: 'same', question: stem, options, contentFingerprint: 'fp-1' }),
    q({ id: 'retyped', question: 'A resistor draws 2 A from a 20 V supply.  What is the resistance of the resistor in the circuit ?', options, contentFingerprint: 'fp-2' }),
    q({ id: 'other-values', question: 'A resistor draws 4 A from a 20 V supply. What is the resistance of the resistor in the circuit?', options, contentFingerprint: 'fp-3' }),
    q({ id: 'unrelated', question: 'Which instrument measures the insulation resistance of motor windings?', options, contentFingerprint: 'fp-4' }),
  ];
  const found = findDuplicates(bank, incoming);
  assert.equal(found.get('same')?.kind, 'exact');
  assert.equal(found.get('retyped')?.kind, 'near');
  assert.equal(found.get('retyped')?.match.id, 'bank-1');
  assert.equal(found.has('other-values'), false);
  assert.equal(found.has('unrelated'), false);
});

test('publishing: duplicates are skipped by default, or replace the bank copy, or are kept', () => {
  const bank = [q({ id: 'bank-1', question: stem, options, contentFingerprint: 'fp-1', createdAt: '2026-01-01', explanation: 'old' })];
  const src = { ...INITIAL_PDF_SOURCES[0]!, id: 'src', filename: 'new.pdf' };
  const dup = q({ id: 'imp-1', question: stem, options, contentFingerprint: 'fp-1', explanation: 'new', course: 'RME' });

  const skipped = publishQuestionsToBank(bank, [], [dup], src);
  assert.equal(skipped.skipped.length, 1);
  assert.equal(skipped.questions.length, 1);

  const replaced = publishQuestionsToBank(bank, [], [dup], src, { 'imp-1': 'replace' });
  assert.equal(replaced.questions.length, 1);
  assert.equal(replaced.replaced.length, 1);
  assert.equal(replaced.questions[0]!.id, 'bank-1'); // exam history keeps pointing at it
  assert.equal(replaced.questions[0]!.createdAt, '2026-01-01');
  assert.equal(replaced.questions[0]!.explanation, 'new');
  assert.equal(replaced.questions[0]!.course, 'RME'); // the program chosen at import

  const kept = publishQuestionsToBank(bank, [], [dup], src, { 'imp-1': 'keep' });
  assert.equal(kept.questions.length, 2);
  assert.equal(kept.skipped.length, 0);
});

// ---- Solutions ----

test('solutions use the Given / Find / Formula / Solution / Final Answer / Explanation layout', () => {
  const text = formatStructuredSolution({
    given: [
      { label: 'I', value: '2 A' },
      { label: 'V', value: '20 V' },
    ],
    find: 'Resistance R',
    formulas: ['R = V / I'],
    steps: ['R = 20 V / 2 A', '2) R = 10 Ω'],
    finalAnswer: 'R = 10 Ω',
    explanation: "Ohm's law relates voltage, current and resistance.",
  });
  assert.equal(
    text,
    "Given:\n• I = 2 A\n• V = 20 V\n\nFind:\nResistance R\n\nFormula:\n• R = V / I\n\nSolution:\n1. R = 20 V / 2 A\n2. R = 10 Ω\n\nFinal Answer:\nR = 10 Ω\n\nExplanation:\nOhm's law relates voltage, current and resistance."
  );
  const sections = parseSolutionSections(text);
  assert.deepEqual(sections.map((s) => s.heading), ['Given', 'Find', 'Formula', 'Solution', 'Final Answer', 'Explanation']);
  // A conceptual answer has no Given or Formula section.
  assert.doesNotMatch(formatStructuredSolution({ given: [], find: 'The device', formulas: [], steps: [], finalAnswer: 'Megger', explanation: 'x' }), /Given|Formula|Solution:/);
  assert.deepEqual(parseSolutionSections('free text'), [{ heading: null, body: 'free text' }]);
});

test('the solver output is normalised into the structured layout, and an invented choice is dropped', () => {
  const input = { question: stem, options };
  const s = normalizeSolution(
    {
      answerKey: 'a',
      confidence: 'high',
      givenValues: [{ label: 'I', value: '2 A' }],
      find: 'R',
      formulasUsed: ['R = V/I'],
      solutionSteps: ['R = 20/2 = 10 Ω'],
      finalAnswerWithUnit: '10 Ω',
      explanation: "Ohm's law",
      verification: 'I = V/R = 2 A',
    },
    input,
    'test-model'
  );
  assert.equal(s.suggestedAnswer, 'A');
  assert.equal(s.find, 'R');
  assert.match(s.stepByStepSolution, /^Given:\n• I = 2 A\n\nFind:\nR\n\nFormula:\n• R = V\/I\n\nSolution:\n1\. R = 20\/2 = 10 Ω\n2\. Check: I = V\/R = 2 A\n\nFinal Answer:\n10 Ω/);
  const invented = normalizeSolution({ answerKey: 'E', confidence: 'high', explanation: '', find: '', solutionSteps: [] }, input, 'm');
  assert.equal(invented.suggestedAnswer, undefined);
  assert.equal(invented.confidence, 'low');
});

test('"Regenerate solution" keeps the answer and flags a disagreement instead of changing it', () => {
  const question = q({ id: 'x', options, correctAnswer: 'B', answerSource: 'admin', verificationStatus: 'manual_override', extractionIssues: [] });
  const solution = { suggestedAnswer: 'A', confidence: 'high' as const, explanation: 'e', stepByStepSolution: 'Find:\nR', formulasUsed: [], givenValues: [], finalAnswerWithUnit: '10 Ω', model: 'm', generatedAt: '' };
  const next = applySolutionOnly(question, solution);
  assert.equal(next.correctAnswer, 'B');
  assert.equal(next.stepByStepSolution, 'Find:\nR');
  assert.ok(next.extractionIssues?.some((i) => i.code === 'AI_DISAGREES'));
});

// ---- Import sessions ----

test('drafts get the chosen program and subject, stay unpublished, and keep their wording', () => {
  const extracted = [q({ id: 'e1', question: 'Original wording ⟦x⟧', isPublished: true, subjectId: 'math' })];
  const [draft] = prepareDrafts(extracted, 'RME', 'ee');
  assert.equal(draft!.course, 'RME');
  assert.equal(draft!.subjectId, 'ee');
  assert.equal(draft!.isPublished, false);
  assert.equal(draft!.question, 'Original wording ⟦x⟧');
  assert.equal(prepareDrafts(extracted, 'REE', 'auto')[0]!.subjectId, 'math');
});

test('a result too large for one Firestore document drops its page texts first', () => {
  const result = {
    filename: 'f.pdf',
    totalPages: 1,
    documentHash: 'h',
    sourcePdfId: 's',
    questions: [],
    report: { overallStatus: 'verified' } as any,
    documentIssues: [],
    preamble: '',
    pageTexts: [{ page: 1, text: 'x'.repeat(2000) }],
    engine: 'e',
  };
  assert.equal(storableResult(result).droppedPageTexts, false);
  const small = storableResult(result, 1000);
  assert.equal(small.droppedPageTexts, true);
  assert.deepEqual(small.result.pageTexts, []);
  assert.equal('questions' in small.result, false);
});

test('counts and totals for the processing dashboard', () => {
  const drafts = [
    q({ id: 'a', correctAnswer: 'A', stepByStepSolution: 'x', contentStatus: 'verified', verificationStatus: 'verified', reviewStatus: 'approved' }),
    q({ id: 'b', correctAnswer: '', stepByStepSolution: '', contentStatus: 'needs_review', verificationStatus: 'needs_verification', reviewStatus: 'pending' }),
    q({ id: 'c', reviewStatus: 'rejected' }),
  ];
  const counts = computeCounts({ result: { totalPages: 4, report: { totalQuestionsDetected: 3 } } as any, publishedIds: ['a'] }, drafts, new Map([['b', {} as any]]));
  assert.deepEqual(counts, { pages: 4, detected: 3, extracted: 2, answered: 1, solved: 1, needVerification: 1, duplicates: 1, approved: 1, published: 1 });
  const session = (status: ImportSession['status'], c = counts) => ({ status, counts: c }) as ImportSession;
  const t = totals([session('ready'), session('error', { ...EMPTY_COUNTS, pages: 2 }), session('extracting', EMPTY_COUNTS)]);
  assert.equal(t.files, 3);
  assert.equal(t.pages, 6);
  assert.equal(t.errors, 1);
  assert.equal(t.inProgress, 1);
  assert.equal(wasInterrupted('extracting'), true);
  assert.equal(wasInterrupted('ready'), false);
  assert.equal(needsAnswer(q({ options, aiSolution: undefined, reviewStatus: 'pending' })), true);
  assert.equal(needsAnswer(q({ options: [options[0]!], aiSolution: undefined })), false);
});

test('programs are listed with their subjects', () => {
  assert.deepEqual(EXAM_PROGRAMS.map((p) => p.id), ['REE', 'RME']);
  assert.deepEqual(programById('REE').subjects.map((s) => s.code), ['MATH', 'ESAS', 'EE']);
});

test('import sessions and drafts are the administrator’s only', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const block = /match \/importSessions\/\{sessionId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
  assert.match(block, /allow read, write: if isAdmin\(\);/);
  assert.match(block, /match \/drafts\/\{draftId\} \{\s*allow read, write: if isAdmin\(\);/);
});

test('importer screens render', () => {
  const sample = {
    id: 'imp-1',
    filename: 'board.pdf',
    fileSize: '1 MB',
    fileBytes: 1,
    fileHash: 'h',
    kind: 'pdf',
    program: 'REE',
    subjectId: 'auto',
    autoAnswer: true,
    status: 'answering',
    createdAt: '',
    updatedAt: '',
    createdBy: '',
    draftOrder: ['a'],
    publishedIds: [],
    acknowledgedMissing: [],
    duplicateDecisions: {},
    answering: { done: 1, total: 4, failed: 0 },
    counts: { ...EMPTY_COUNTS, extracted: 4 },
    logs: [{ at: '2026-11-12T00:00:00Z', level: 'info', message: 'Queued.' }],
  } as ImportSession;
  assert.match(renderToStaticMarkup(React.createElement(ImportDashboard, { totals: totals([sample]), loading: false })), /Pages analyzed/);
  assert.match(
    renderToStaticMarkup(React.createElement(ImportQueueList, { sessions: [sample], progress: {}, selectedId: null, onOpen: () => {}, onRetry: () => {}, onCancel: () => {}, onDelete: () => {} })),
    /AI answers 1\/4/
  );
  const uploader = renderToStaticMarkup(
    React.createElement(ImportUploader, { server: null, tokenRequired: false, signInAccepted: true, token: '', onTokenChange: () => {}, onStart: async () => {} })
  );
  assert.match(uploader, /Examination program/);
  assert.match(uploader, /Detect per question/);
  const dialog = renderToStaticMarkup(
    React.createElement(SolutionDialog, { question: q({ options, correctAnswer: 'A', stepByStepSolution: 'Given:\n• I = 2 A\n\nFinal Answer:\n10 Ω' }), onClose: () => {} })
  );
  assert.match(dialog, /Given/);
  assert.match(dialog, /Final Answer/);
  assert.match(dialog, /A\. 10 ohms/);
});
