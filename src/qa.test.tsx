import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App.tsx';
import * as data from './data/seedData.ts';
import { calculateExamScore } from './utils/examEngine.ts';
import { ActiveExamView } from './components/ActiveExamView.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AuditLogsView } from './components/AuditLogsView.tsx';
import { ExamLauncherModal } from './components/ExamLauncherModal.tsx';
import { ExamResultView } from './components/ExamResultView.tsx';
import { FormulaReferenceDrawer } from './components/FormulaReferenceDrawer.tsx';
import { Navbar } from './components/Navbar.tsx';
import { PdfImporterView } from './components/PdfImporterView.tsx';
import { PdfQuizGeneratorView } from './components/PdfQuizGeneratorView.tsx';
import { PdfSourcesView } from './components/PdfSourcesView.tsx';
import { QuestionBankView } from './components/QuestionBankView.tsx';
import { RevieweeDashboard } from './components/RevieweeDashboard.tsx';
import { RevieweeRosterView } from './components/RevieweeRosterView.tsx';
import { ScientificCalculatorModal } from './components/ScientificCalculatorModal.tsx';
import type { ExamConfig } from './types/index.ts';

const noop = () => {};
const questions = data.INITIAL_QUESTIONS;
const pdfSources = data.INITIAL_PDF_SOURCES;
const examResults = data.INITIAL_EXAM_RESULTS;
const subjects = data.SUBJECTS;
const auditLogs = data.INITIAL_AUDIT_LOGS;
const config: ExamConfig = { type: 'practice', title: 'QA', description: '', questionCount: 12,
  durationMinutes: 20, passingPercentage: 70, randomizeQuestions: false,
  randomizeChoices: false, instantFeedback: false };

// Render smoke checks cover every component, including open overlays. They do not
// claim browser interaction coverage: effects and event handlers need separate tests.
const screens: [string, React.ReactElement][] = [
  ['App', <App />],
  ['ActiveExamView', <ActiveExamView config={config} questions={questions} onFinishExam={noop} onExitExam={noop} />],
  ['AdminDashboard', <AdminDashboard adminUser={data.DEMO_USERS[0]} {...{ questions, pdfSources, examResults, auditLogs }} onNavigate={noop} />],
  ['AuditLogsView', <AuditLogsView auditLogs={auditLogs} />],
  ['ExamLauncherModal', <ExamLauncherModal isOpen initialType="practice" {...{subjects, pdfSources}} onClose={noop} onLaunch={noop} />],
  ['ExamResultView', <ExamResultView result={examResults[0]} questions={questions} onRetake={noop} onBackToDashboard={noop} />],
  ['FormulaReferenceDrawer', <FormulaReferenceDrawer isOpen onClose={noop} />],
  ['Navbar', <Navbar currentUser={data.DEMO_USERS[1]} currentView="reviewee-dashboard" onNavigate={noop} onSwitchRole={noop} allUsers={data.DEMO_USERS} onSelectUser={noop} pendingVerificationCount={0} />],
  ['PdfImporterView', <PdfImporterView existingQuestions={questions} pdfSources={pdfSources} onPublishQuestions={noop} onAddAuditLog={noop} />],
  ['PdfQuizGeneratorView', <PdfQuizGeneratorView {...{questions, pdfSources}} onStartPdfQuiz={noop} />],
  ['PdfSourcesView', <PdfSourcesView pdfSources={pdfSources} onUpdateSource={noop} onNavigateToImporter={noop} onNavigateToQuiz={noop} />],
  ['QuestionBankView', <QuestionBankView {...{questions, subjects, pdfSources}} onAddQuestion={noop} onUpdateQuestion={noop} onDeleteQuestion={noop} onTogglePublish={noop} />],
  ['RevieweeDashboard', <RevieweeDashboard user={data.DEMO_USERS[1]} {...{subjects, examResults, pdfSources}} onStartExam={noop} onNavigate={noop} onViewResult={noop} />],
  ['RevieweeRosterView', <RevieweeRosterView reviewees={[data.DEMO_USERS[1]]} examResults={examResults} />],
  ['ScientificCalculatorModal', <ScientificCalculatorModal isOpen onClose={noop} />],
];
for (const [name, element] of screens) test(`render: ${name}`, () => {
  assert.ok(renderToStaticMarkup(element).length > 0);
});

test('seed questions have unique IDs and valid answer choices', () => {
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
  for (const q of questions) {
    assert.ok(q.options.some(o => o.key === q.correctAnswer), q.id);
    assert.equal(new Set(q.options.map(o => o.key)).size, q.options.length, q.id);
    assert.ok(subjects.some(s => s.id === q.subjectId), q.id);
    assert.ok(pdfSources.some(p => p.id === q.sourcePdfId), q.id);
  }
});
test('seed PDF counts match the actual bank', () => {
  for (const pdf of pdfSources) assert.equal(
    questions.filter(q => q.sourcePdfId === pdf.id).length, pdf.questionsCount, pdf.id);
});
test('empty exam cannot pass', () => assert.equal(calculateExamScore([], {}).isPassed, false));
test('unanswered questions remain in score denominator', () => {
  const result = calculateExamScore(questions, {});
  assert.equal(result.unansweredCount, questions.length);
  assert.equal(result.scorePercentage, 0);
});
test('69.565 percent must not pass a 70 percent threshold', () => {
  const qs = Array.from({length: 23}, (_, i) => ({...questions[0], id: String(i)}));
  const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 16 ? q.correctAnswer : 'wrong']));
  assert.equal(calculateExamScore(qs, answers).isPassed, false);
});
test('49.505 percent in one subject must not satisfy the 50 percent floor', () => {
  const qs = Array.from({length: 202}, (_, i) => ({...questions[0], id: String(i), subjectId: i < 101 ? 'math' : 'ee'}));
  const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 50 || i >= 101 ? q.correctAnswer : 'wrong']));
  assert.equal(calculateExamScore(qs, answers).isPassed, false);
});

test('sanitizeForFirestore removes undefined fields recursively for Firestore compatibility', async () => {
  const { sanitizeForFirestore } = await import('./utils/firebaseSync.ts');
  const dirtyData = {
    id: 'ext-123',
    question: 'Test Question',
    subtopic: undefined,
    extractedAnswerKey: undefined,
    options: [
      { key: 'A', text: 'Opt A' },
      { key: 'B', text: 'Opt B' },
    ],
    metadata: {
      nestedUndefined: undefined,
      validField: 'hello',
    },
  };
  const cleaned = sanitizeForFirestore(dirtyData);
  assert.equal('subtopic' in cleaned, false);
  assert.equal('extractedAnswerKey' in cleaned, false);
  assert.equal('nestedUndefined' in (cleaned as any).metadata, false);
  assert.equal((cleaned as any).metadata.validField, 'hello');
  assert.equal(cleaned.question, 'Test Question');
});

