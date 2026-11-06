import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INITIAL_PDF_SOURCES, INITIAL_QUESTIONS } from './data/seedData.ts';
import type { ExamConfig, ExamResult, PdfSource, Question } from './types/index.ts';
import {
  examTypeToSourceMode,
  getDefaultSelectedIds,
  getReviewQuestions,
  getSelectableSources,
  isQuestionEligibleForExam,
  publishQuestionsToBank,
  reconcileSourceCounts,
  selectExamQuestions,
  splitPublishableQuestions,
} from './utils/bank.ts';
import { calculateExamScore } from './utils/examEngine.ts';
import { createExamCountdown } from './utils/examTimer.ts';
import { classifyQuestionnaireFile, formatFileSize } from './utils/importFile.ts';
import { isRecordArray, loadPersisted, savePersisted, type StorageLike } from './utils/persistence.ts';

const question = (over: Partial<Question> = {}): Question => ({ ...INITIAL_QUESTIONS[0], sourcePdfId: 's1', ...over });
const source = (over: Partial<PdfSource> = {}): PdfSource => ({
  ...INITIAL_PDF_SOURCES[0],
  id: 's1',
  filename: 'one.pdf',
  isPublicToReviewees: true,
  allowedModes: ['quiz', 'practice', 'preboard', 'mock'],
  ...over,
});
const config = (over: Partial<ExamConfig> = {}): ExamConfig => ({
  type: 'practice',
  title: 'T',
  description: '',
  questionCount: 10,
  durationMinutes: 10,
  passingPercentage: 70,
  randomizeQuestions: false,
  randomizeChoices: false,
  instantFeedback: false,
  ...over,
});
const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

// Scoring boundaries (QA items 1-2)
test('exactly 70 percent overall and 50 percent per subject still pass', () => {
  const qs = Array.from({ length: 10 }, (_, i) => question({ id: String(i), subjectId: 'ee' }));
  const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 7 ? q.correctAnswer : 'wrong']));
  assert.equal(calculateExamScore(qs, answers).isPassed, true);

  const split = Array.from({ length: 4 }, (_, i) => question({ id: String(i), subjectId: i < 2 ? 'math' : 'ee' }));
  const splitAnswers = { '0': split[0].correctAnswer, '1': 'wrong', '2': split[2].correctAnswer, '3': split[3].correctAnswer };
  const subjects = calculateExamScore(split, splitAnswers).subjectBreakdown;
  assert.equal(subjects.math.passed, true);
});

test('rounded display percentage is kept separate from the pass decision', () => {
  const qs = Array.from({ length: 23 }, (_, i) => question({ id: String(i) }));
  const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 16 ? q.correctAnswer : 'wrong']));
  const result = calculateExamScore(qs, answers);
  assert.equal(result.scorePercentage, 70);
  assert.equal(result.isPassed, false);
});

// Seed metadata (QA item 3)
test('seed verified, review and coverage counts match the bank', () => {
  for (const pdf of INITIAL_PDF_SOURCES) {
    assert.deepEqual(reconcileSourceCounts(pdf, INITIAL_QUESTIONS), pdf, pdf.id);
  }
});

// Source visibility and modes (QA item 7)
test('restricted sources and disallowed modes are excluded from exams', () => {
  const restricted = source({ isPublicToReviewees: false });
  assert.equal(isQuestionEligibleForExam(question(), 'practice', [restricted]), false);

  const quizOnly = source({ allowedModes: ['quiz'] });
  assert.equal(isQuestionEligibleForExam(question(), 'quiz', [quizOnly]), true);
  assert.equal(isQuestionEligibleForExam(question(), 'final_mock', [quizOnly]), false);
  assert.equal(isQuestionEligibleForExam(question(), 'pre_board', [quizOnly]), false);
});

test('every exam type maps to a source mode, and hidden sources are not selectable', () => {
  assert.equal(examTypeToSourceMode('pre_board'), 'preboard');
  assert.equal(examTypeToSourceMode('final_mock'), 'mock');
  assert.equal(examTypeToSourceMode('pdf_quiz'), 'quiz');
  assert.equal(examTypeToSourceMode('pre_test'), 'practice');
  const visible = source({ id: 'open' });
  const hidden = source({ id: 'hidden', isPublicToReviewees: false });
  const noQuiz = source({ id: 'noquiz', allowedModes: ['mock'] });
  assert.deepEqual(getSelectableSources([visible, hidden, noQuiz], 'pdf_quiz').map((s) => s.id), ['open']);
});

test('launching a restricted PDF set directly is refused', () => {
  const result = selectExamQuestions(
    [question()],
    [source({ isPublicToReviewees: false })],
    config({ type: 'pdf_quiz', pdfSourceId: 's1' })
  );
  assert.equal(result.ok, false);
});

test('a PDF set with no source selected is refused instead of using the whole bank', () => {
  assert.equal(selectExamQuestions([question()], [source()], config({ type: 'pdf_quiz', pdfSourceId: '' })).ok, false);
});

test('questions from an unknown source are excluded, manual questions are allowed', () => {
  assert.equal(isQuestionEligibleForExam(question({ sourcePdfId: 'gone' }), 'practice', [source()]), false);
  assert.equal(isQuestionEligibleForExam(question({ sourcePdfId: undefined }), 'practice', []), true);
});

// Empty filters (QA item 8)
test('filters with no matches return an error, not the whole bank', () => {
  const bank = [question({ id: 'a', difficulty: 'Easy', subjectId: 'ee' })];
  for (const over of [{ difficulty: 'Difficult' as const }, { subjectId: 'math' as const }, { topic: 'Nothing' }]) {
    const result = selectExamQuestions(bank, [source()], config(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    if (!result.ok) assert.match(result.error, /No published, reviewed questions/);
  }
});

test('selection honours filters and question count, and shuffling keeps every question', () => {
  const bank = Array.from({ length: 6 }, (_, i) => question({ id: `q${i}`, difficulty: i < 4 ? 'Easy' : 'Average' }));
  const filtered = selectExamQuestions(bank, [source()], config({ difficulty: 'Easy', questionCount: 3 }));
  assert.ok(filtered.ok);
  if (filtered.ok) assert.deepEqual(filtered.questions.map((q) => q.id), ['q0', 'q1', 'q2']);

  const all = selectExamQuestions(bank, [source()], config({ randomizeQuestions: true, randomizeChoices: true }), () => 0);
  assert.ok(all.ok);
  if (all.ok) {
    assert.deepEqual(all.questions.map((q) => q.id).sort(), bank.map((q) => q.id));
    assert.notDeepEqual(all.questions.map((q) => q.id), bank.map((q) => q.id));
  }
});

// Historical snapshots (QA item 9)
test('review uses the stored snapshot, including skipped and since-edited or deleted questions', () => {
  const asked = [question({ id: 'answered' }), question({ id: 'skipped' }), question({ id: 'deleted', question: 'Original text' })];
  const result = {
    ...{ userAnswers: { answered: 'A' }, flaggedQuestionIds: [], totalQuestions: 3 },
    questionSnapshots: asked,
  } as unknown as ExamResult;
  const bankAfterEdits = [question({ id: 'answered', question: 'Edited text' })];
  const reviewed = getReviewQuestions(result, bankAfterEdits);
  assert.deepEqual(reviewed.map((q) => q.id), ['answered', 'skipped', 'deleted']);
  assert.equal(reviewed[0].question, asked[0].question);
  assert.equal(reviewed[2].question, 'Original text');
});

test('results without snapshots still open from the current bank', () => {
  const legacy = { userAnswers: { a: 'A' }, flaggedQuestionIds: ['b'], totalQuestions: 2 } as unknown as ExamResult;
  const reviewed = getReviewQuestions(legacy, [question({ id: 'a' }), question({ id: 'b' }), question({ id: 'c' })]);
  assert.deepEqual(reviewed.map((q) => q.id), ['a', 'b']);
});

// File handling (QA items 10-11)
test('files are classified the same way whatever MIME type the browser reports', () => {
  assert.equal(classifyQuestionnaireFile({ name: 'exam.PDF', type: '' }), 'pdf');
  assert.equal(classifyQuestionnaireFile({ name: 'exam.pdf', type: 'application/octet-stream' }), 'pdf');
  assert.equal(classifyQuestionnaireFile({ name: 'exam', type: 'application/pdf' }), 'pdf');
  assert.equal(classifyQuestionnaireFile({ name: 'exam.txt', type: '' }), 'text');
  assert.equal(classifyQuestionnaireFile({ name: 'notes.docx', type: 'application/msword' }), null);
  assert.equal(formatFileSize(1536 * 1024), '1.5 MB');
});

test('importer source no longer truncates text or checks only the PDF MIME type', async () => {
  const source = await readFile(new URL('./components/PdfImporterView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /slice\(0, 5000\)/);
  assert.doesNotMatch(source, /\.type === 'application\/pdf'/);
});

// Reimport and partial publishing (QA item 12)
test('reimporting a filename keeps the source ID and settings, and counts add up', () => {
  const original = source({
    id: 'stable',
    filename: 'same.pdf',
    isPublicToReviewees: false,
    allowedModes: ['quiz'],
    fileSize: '9 MB',
  });
  const existing = [question({ id: 'old', sourcePdfId: 'stable' })];
  const incomingSource = source({ id: 'new-id', filename: 'same.pdf', fileSize: '1 KB', questionsCount: 1 });
  const first = publishQuestionsToBank(existing, [original], [question({ id: 'n1', sourcePdfId: 'new-id' })], incomingSource);
  const second = publishQuestionsToBank(first.questions, first.sources, [question({ id: 'n2', sourcePdfId: 'new-id' })], incomingSource);

  assert.equal(second.sources.length, 1);
  const saved = second.sources[0];
  assert.equal(saved.id, 'stable');
  assert.equal(saved.questionsCount, 3);
  assert.equal(saved.isPublicToReviewees, false);
  assert.deepEqual(saved.allowedModes, ['quiz']);
  assert.equal(saved.fileSize, '9 MB');
  assert.ok(second.questions.every((q) => q.sourcePdfId === 'stable'));
});

test('a new filename adds a source with counts from its own questions', () => {
  const incoming = source({ id: 'fresh', filename: 'fresh.pdf', questionsCount: 99 });
  const result = publishQuestionsToBank([], [source()], [question({ id: 'x', sourcePdfId: 'fresh' })], incoming);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].id, 'fresh');
  assert.equal(result.sources[0].questionsCount, 1);
});

// Publishing uncertain answers (QA item 14)
test('uncertain answers are not selected by default and cannot be published until approved', () => {
  const staged = [
    question({ id: 'ok', verificationStatus: 'verified' }),
    question({ id: 'unsure', verificationStatus: 'needs_verification' }),
    question({ id: 'clash', verificationStatus: 'discrepancy_flagged' }),
    question({ id: 'approved', verificationStatus: 'manual_override' }),
  ];
  assert.deepEqual(getDefaultSelectedIds(staged), ['ok', 'approved']);
  const { publishable, held } = splitPublishableQuestions(staged, staged.map((q) => q.id));
  assert.deepEqual(publishable.map((q) => q.id), ['ok', 'approved']);
  assert.deepEqual(held.map((q) => q.id), ['unsure', 'clash']);
});

test('uncertain or unpublished questions never enter a scored exam', () => {
  const bank = [
    question({ id: 'unsure', verificationStatus: 'needs_verification' }),
    question({ id: 'clash', verificationStatus: 'discrepancy_flagged' }),
    question({ id: 'draft', isPublished: false }),
    question({ id: 'approved', verificationStatus: 'manual_override' }),
  ];
  const result = selectExamQuestions(bank, [source()], config());
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.questions.map((q) => q.id), ['approved']);
});

// Persistence (QA item 5)
test('saved data survives a reload and bad or missing data falls back', () => {
  const storage = memoryStorage();
  const seed = [{ id: 'seed' }];
  assert.deepEqual(loadPersisted('k', seed, isRecordArray, storage), seed);

  assert.equal(savePersisted('k', [{ id: 'changed' }], storage), true);
  assert.deepEqual(loadPersisted('k', seed, isRecordArray, storage), [{ id: 'changed' }]);

  storage.data.set('nexora.v1.bad', '{not json');
  assert.deepEqual(loadPersisted('bad', seed, isRecordArray, storage), seed);
  storage.data.set('nexora.v1.shape', JSON.stringify([{ noId: true }]));
  assert.deepEqual(loadPersisted('shape', seed, isRecordArray, storage), seed);
});

test('a failed save is reported, not thrown', () => {
  const full: StorageLike = {
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(savePersisted('k', [], full), false);
  assert.equal(savePersisted('k', [], null), false);
});

// Timer (QA item 13)
test('rapid answering cannot extend the deadline', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const ticks: number[] = [];
  let expired = 0;
  const timer = createExamCountdown({ durationSeconds: 10, onTick: (s) => ticks.push(s), onExpire: () => expired++ });
  timer.start();
  // The old timer restarted on every answer; answers now only re-render, so the clock runs on.
  for (let i = 0; i < 40; i++) t.mock.timers.tick(100);
  assert.equal(timer.getRemainingSeconds(), 6);
  t.mock.timers.tick(6000);
  assert.equal(expired, 1);
  assert.equal(ticks.at(-1), 0);
  timer.stop();
});

test('a delayed background timer still honours the real deadline', (t) => {
  let clock = 0;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let expired = 0;
  const timer = createExamCountdown({ durationSeconds: 60, now: () => clock, onTick: () => {}, onExpire: () => expired++ });
  timer.start();
  clock = 90_000; // the tab was asleep past the deadline and no ticks ran
  timer.sync();
  assert.equal(timer.getRemainingSeconds(), 0);
  assert.equal(expired, 1);
  assert.equal(timer.getElapsedSeconds(), 60, 'elapsed time is capped at the exam length');
});

test('stopping and restarting keeps the same deadline', (t) => {
  let clock = 0;
  t.mock.timers.enable({ apis: ['setInterval'] });
  const timer = createExamCountdown({ durationSeconds: 60, now: () => clock, onTick: () => {}, onExpire: () => {} });
  timer.start();
  timer.stop();
  clock = 20_000;
  timer.start();
  assert.equal(timer.getRemainingSeconds(), 40);
  timer.stop();
});

test('expiry and manual submit can only finish the exam once', (t) => {
  let clock = 0;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let submissions = 0;
  const submit = (timer: { claimFinish: () => boolean }) => {
    if (timer.claimFinish()) submissions++;
  };
  const timer = createExamCountdown({ durationSeconds: 5, now: () => clock, onTick: () => {}, onExpire: () => submit(timer) });
  timer.start();
  clock = 5_000;
  t.mock.timers.tick(250);
  t.mock.timers.tick(250);
  submit(timer); // the user confirms just after time ran out
  timer.sync();
  assert.equal(submissions, 1);
});
