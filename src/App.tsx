/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  UserProfile,
  UserRole,
  Question,
  PdfSource,
  ExamResult,
  AuditLog,
  ExamConfig,
  ExamType,
} from './types/index.ts';
import {
  SUBJECTS,
  DEMO_USERS,
  INITIAL_QUESTIONS,
  INITIAL_PDF_SOURCES,
  INITIAL_EXAM_RESULTS,
  INITIAL_AUDIT_LOGS,
} from './data/seedData.ts';
import { calculateExamScore } from './utils/examEngine.ts';
import {
  getReviewQuestions,
  isReviewedForExams,
  publishQuestionsToBank,
  reconcileSourceCounts,
  selectExamQuestions,
} from './utils/bank.ts';
import { isRecordArray, usePersistentState } from './utils/persistence.ts';

// Components
import { Navbar } from './components/Navbar.tsx';
import { RevieweeDashboard } from './components/RevieweeDashboard.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { PdfImporterView } from './components/PdfImporterView.tsx';
import { QuestionBankView } from './components/QuestionBankView.tsx';
import { PdfSourcesView } from './components/PdfSourcesView.tsx';
import { PdfQuizGeneratorView } from './components/PdfQuizGeneratorView.tsx';
import { ActiveExamView } from './components/ActiveExamView.tsx';
import { ExamResultView } from './components/ExamResultView.tsx';
import { ExamLauncherModal } from './components/ExamLauncherModal.tsx';
import { RevieweeRosterView } from './components/RevieweeRosterView.tsx';
import { AuditLogsView } from './components/AuditLogsView.tsx';

export default function App() {
  // State
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEMO_USERS[1]); // default to Reviewee
  const [currentView, setCurrentView] = useState<string>('reviewee-dashboard');

  // Saved in this browser only. See utils/persistence.ts.
  const [failedSaves, setFailedSaves] = useState<string[]>([]);
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);
  const handleSaved = useCallback((key: string, succeeded: boolean) => {
    setFailedSaves((prev) => {
      const others = prev.filter((item) => item !== key);
      if (succeeded) return others.length === prev.length ? prev : others;
      return [...others, key];
    });
  }, []);
  const [questions, setQuestions] = usePersistentState<Question[]>('questions', INITIAL_QUESTIONS, isRecordArray<Question>, handleSaved);
  const [storedSources, setPdfSources] = usePersistentState<PdfSource[]>('sources', INITIAL_PDF_SOURCES, isRecordArray<PdfSource>, handleSaved);
  const [examResults, setExamResults] = usePersistentState<ExamResult[]>('results', INITIAL_EXAM_RESULTS, isRecordArray<ExamResult>, handleSaved);
  const [auditLogs, setAuditLogs] = usePersistentState<AuditLog[]>('audit', INITIAL_AUDIT_LOGS, isRecordArray<AuditLog>, handleSaved);

  // Counts always come from the bank, so edits, deletes and partial publishes can't drift.
  const pdfSources = useMemo(
    () => storedSources.map((source) => reconcileSourceCounts(source, questions)),
    [storedSources, questions]
  );

  // Active Examination Session State
  const [activeExamConfig, setActiveExamConfig] = useState<ExamConfig | null>(null);
  const [activeExamQuestions, setActiveExamQuestions] = useState<Question[]>([]);
  const [activeResult, setActiveResult] = useState<ExamResult | null>(null);

  // Modal Launcher State
  const [launcherModalOpen, setLauncherModalOpen] = useState<boolean>(false);
  const [launcherType, setLauncherType] = useState<ExamType>('practice');
  const [launcherSubjectId, setLauncherSubjectId] = useState<string | undefined>(undefined);
  const [launcherTopic, setLauncherTopic] = useState<string | undefined>(undefined);
  const [launcherPdfSourceId, setLauncherPdfSourceId] = useState<string | undefined>(undefined);
  const [launcherNotice, setLauncherNotice] = useState<string | undefined>(undefined);

  const handleResetDemoData = () => {
    setQuestions(INITIAL_QUESTIONS);
    setPdfSources(INITIAL_PDF_SOURCES);
    setExamResults(INITIAL_EXAM_RESULTS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setConfirmingReset(false);
    setCurrentView(currentUser.role === 'admin' ? 'admin-dashboard' : 'reviewee-dashboard');
  };

  // Role switching
  const handleSwitchRole = (role: UserRole) => {
    if (role === 'admin') {
      const admin = DEMO_USERS.find((u) => u.role === 'admin') || DEMO_USERS[0];
      setCurrentUser(admin);
      setCurrentView('admin-dashboard');
    } else {
      const reviewee = DEMO_USERS.find((u) => u.role === 'reviewee') || DEMO_USERS[1];
      setCurrentUser(reviewee);
      setCurrentView('reviewee-dashboard');
    }
  };

  const handleNavigate = (view: string) => {
    // Role protection
    if (currentUser.role === 'reviewee') {
      const adminOnlyViews = ['admin-dashboard', 'pdf-importer', 'question-bank', 'pdf-sources', 'reviewees-roster', 'audit-logs'];
      if (adminOnlyViews.includes(view)) {
        setCurrentView('reviewee-dashboard');
        return;
      }
    }

    if (view === 'pre-test-hub') {
      handleOpenLauncher('pre_test');
      return;
    }
    if (view === 'quizzes-hub') {
      handleOpenLauncher('quiz');
      return;
    }
    if (view === 'practice-hub') {
      handleOpenLauncher('practice');
      return;
    }
    if (view === 'preboard-hub') {
      handleOpenLauncher('pre_board');
      return;
    }
    if (view === 'mock-hub') {
      handleOpenLauncher('final_mock');
      return;
    }

    setCurrentView(view);
  };

  const handleOpenLauncher = (type: ExamType, subjectId?: string, pdfSourceId?: string, topic?: string, notice?: string) => {
    setLauncherType(type);
    setLauncherSubjectId(subjectId);
    setLauncherTopic(topic);
    setLauncherPdfSourceId(pdfSourceId);
    setLauncherNotice(notice);
    setLauncherModalOpen(true);
  };

  // Starts an exam, or returns why none can be built so the caller can show it.
  const handleLaunchExam = (config: ExamConfig): string | null => {
    const selection = selectExamQuestions(questions, pdfSources, config);
    if (!selection.ok) return selection.error;

    setActiveExamConfig(config);
    setActiveExamQuestions(selection.questions);
    setCurrentView('active-exam');
    return null;
  };

  // Finish exam handler
  const handleFinishExam = (
    userAnswers: Record<string, string>,
    flaggedIds: string[],
    timeConsumedSeconds: number
  ) => {
    if (!activeExamConfig) return;

    const scoreResult = calculateExamScore(activeExamQuestions, userAnswers);

    const newResult: ExamResult = {
      id: `res-${Date.now()}`,
      examId: `exam-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      type: activeExamConfig.type,
      title: activeExamConfig.title,
      subjectId: activeExamConfig.subjectId,
      completedAt: new Date().toISOString(),
      durationSeconds: timeConsumedSeconds,
      totalQuestions: scoreResult.totalQuestions,
      answeredCount: scoreResult.answeredCount,
      unansweredCount: scoreResult.unansweredCount,
      correctCount: scoreResult.correctCount,
      incorrectCount: scoreResult.incorrectCount,
      scorePercentage: scoreResult.scorePercentage,
      isPassed: scoreResult.isPassed,
      userAnswers: userAnswers,
      flaggedQuestionIds: flaggedIds,
      subjectBreakdown: scoreResult.subjectBreakdown,
      weakTopics: scoreResult.weakTopics,
      strongTopics: scoreResult.strongTopics,
      questionSnapshots: activeExamQuestions,
      examConfig: activeExamConfig,
    };

    setExamResults((prev) => [...prev, newResult]);
    setActiveResult(newResult);
    setCurrentView('exam-result');
  };

  // Open a saved result with the questions and settings it was taken with.
  const handleViewResult = (res: ExamResult) => {
    setActiveResult(res);
    setActiveExamConfig(res.examConfig ?? null);
    setActiveExamQuestions(getReviewQuestions(res, questions));
    setCurrentView('exam-result');
  };

  // Admin: Publish new extracted questions
  const handlePublishQuestions = (newQuestions: Question[], sourcePdf: PdfSource) => {
    const published = publishQuestionsToBank(questions, storedSources, newQuestions, sourcePdf);
    setQuestions(published.questions);
    setPdfSources(published.sources);
  };

  // Admin audit log adder
  const handleAddAuditLog = (action: string, details: string, badge?: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, // unique within a bulk action
      adminName: currentUser.name,
      action,
      details,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      badge,
    };
    setAuditLogs((prev) => [newLog, ...prev]);
  };

  const pendingVerificationCount = questions.filter(
    (q) => q.verificationStatus === 'needs_verification' || q.verificationStatus === 'discrepancy_flagged'
  ).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navbar (hidden during active examination for zero distractions) */}
      {currentView !== 'active-exam' && (
        <Navbar
          currentUser={currentUser}
          currentView={currentView}
          onNavigate={handleNavigate}
          onSwitchRole={handleSwitchRole}
          allUsers={DEMO_USERS}
          onSelectUser={(u) => setCurrentUser(u)}
          pendingVerificationCount={pendingVerificationCount}
        />
      )}

      {currentView !== 'active-exam' && (
        <div className="px-4 py-1.5 bg-amber-950/40 border-b border-amber-900/40 text-[11px] text-amber-200 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          <span>
            {failedSaves.length > 0
              ? 'Demo mode: changes could not be saved in this browser and will be lost on refresh.'
              : 'Demo mode: no sign-in. Changes are saved in this browser only and are not shared with other users or devices.'}
          </span>
          {currentUser.role === 'admin' &&
            (confirmingReset ? (
              <span className="flex items-center gap-2">
                Erase all changes in this browser?
                <button onClick={handleResetDemoData} className="underline font-semibold hover:text-white">
                  Yes, reset
                </button>
                <button onClick={() => setConfirmingReset(false)} className="underline hover:text-white">
                  Keep
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmingReset(true)} className="underline hover:text-white">
                Reset demo data
              </button>
            ))}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1">
        {/* REVIEWEE VIEWS */}
        {currentView === 'reviewee-dashboard' && (
          <RevieweeDashboard
            user={currentUser}
            subjects={SUBJECTS}
            examResults={examResults}
            pdfSources={pdfSources}
            onStartExam={(type, subjectId, pdfSourceId, topic) =>
              handleOpenLauncher(type, subjectId, pdfSourceId, topic)
            }
            onNavigate={handleNavigate}
            onViewResult={handleViewResult}
          />
        )}

        {currentView === 'pdf-quiz-generator' && (
          <PdfQuizGeneratorView
            pdfSources={pdfSources}
            questions={questions}
            onStartPdfQuiz={(pdfId, count, diff, duration) => {
              const pdf = pdfSources.find((p) => p.id === pdfId);
              const config: ExamConfig = {
                type: 'pdf_quiz',
                title: `Questionnaire: ${pdf ? pdf.filename : 'Custom Set'}`,
                description: 'Questions extracted from official PDF questionnaire.',
                pdfSourceId: pdfId,
                difficulty: diff as any,
                questionCount: count,
                durationMinutes: duration,
                passingPercentage: 70,
                randomizeQuestions: true,
                randomizeChoices: true,
                instantFeedback: false,
              };
              return handleLaunchExam(config);
            }}
          />
        )}

        {currentView === 'exam-history' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <h1 className="text-2xl font-bold text-white">Full Examination History</h1>
            <div className="space-y-4">
              {examResults.map((exam) => (
                <div
                  key={exam.id}
                  className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <h3 className="font-bold text-white">{exam.title}</h3>
                    <div className="text-xs text-slate-400 mt-1">
                      Score: <strong className="text-emerald-400">{exam.scorePercentage}%</strong> • Completed on {new Date(exam.completedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleViewResult(exam)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl"
                  >
                    Review Solutions
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ACTIVE EXAMINATION */}
        {currentView === 'active-exam' && activeExamConfig && (
          <ActiveExamView
            config={activeExamConfig}
            questions={activeExamQuestions}
            onFinishExam={handleFinishExam}
            onExitExam={() => setCurrentView('reviewee-dashboard')}
          />
        )}

        {/* EXAMINATION RESULTS & STEP-BY-STEP REVIEW */}
        {currentView === 'exam-result' && activeResult && (
          <ExamResultView
            result={activeResult}
            questions={activeExamQuestions}
            onRetake={() => {
              const error = activeExamConfig ? handleLaunchExam(activeExamConfig) : null;
              if (!activeExamConfig || error) {
                handleOpenLauncher(activeResult.type, undefined, undefined, undefined, error ?? undefined);
              }
            }}
            onBackToDashboard={() => setCurrentView('reviewee-dashboard')}
          />
        )}

        {/* ADMINISTRATOR VIEWS */}
        {currentView === 'admin-dashboard' && (
          <AdminDashboard
            adminUser={currentUser}
            questions={questions}
            pdfSources={pdfSources}
            examResults={examResults}
            auditLogs={auditLogs}
            onNavigate={handleNavigate}
          />
        )}

        {currentView === 'pdf-importer' && (
          <PdfImporterView
            existingQuestions={questions}
            pdfSources={pdfSources}
            onPublishQuestions={handlePublishQuestions}
            onAddAuditLog={handleAddAuditLog}
          />
        )}

        {currentView === 'question-bank' && (
          <QuestionBankView
            questions={questions}
            subjects={SUBJECTS}
            pdfSources={pdfSources}
            onAddQuestion={(q) => {
              setQuestions((prev) => [q, ...prev]);
              handleAddAuditLog('Manual Question Created', `Created Question #${q.id} in ${q.subjectName}.`);
            }}
            onUpdateQuestion={(q) => {
              setQuestions((prev) => prev.map((item) => (item.id === q.id ? q : item)));
              handleAddAuditLog('Question Updated', `Updated parameters for Question #${q.id}.`);
            }}
            onDeleteQuestion={(id) => {
              setQuestions((prev) => prev.filter((item) => item.id !== id));
              handleAddAuditLog('Question Deleted', `Removed Question #${id} from repository.`);
            }}
            onTogglePublish={(id) => {
              setQuestions((prev) =>
                prev.map((item) => {
                  if (item.id !== id) return item;
                  // Unpublishing is always allowed; publishing needs a reviewed answer.
                  if (!item.isPublished && !isReviewedForExams(item)) return item;
                  return { ...item, isPublished: !item.isPublished };
                })
              );
            }}
            onApproveQuestion={(id) => {
              setQuestions((prev) =>
                prev.map((item) => (item.id === id ? { ...item, verificationStatus: 'manual_override' } : item))
              );
              handleAddAuditLog('Answer Approved by Admin', `Manually approved the answer for Question #${id}.`, 'Override');
            }}
          />
        )}

        {currentView === 'pdf-sources' && (
          <PdfSourcesView
            pdfSources={pdfSources}
            onUpdateSource={(updated) => {
              setPdfSources((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p))
              );
              handleAddAuditLog('PDF Permissions Updated', `Updated permissions for "${updated.filename}".`);
            }}
            onNavigateToImporter={() => setCurrentView('pdf-importer')}
            onNavigateToQuiz={(pdfId) => {
              setCurrentUser(DEMO_USERS[1]); // switch to reviewee
              setCurrentView('pdf-quiz-generator'); // leave the admin-only page along with the role
              handleOpenLauncher('pdf_quiz', undefined, pdfId);
            }}
          />
        )}

        {currentView === 'reviewees-roster' && (
          <RevieweeRosterView reviewees={[DEMO_USERS[1]]} examResults={examResults} />
        )}

        {currentView === 'audit-logs' && (
          <AuditLogsView auditLogs={auditLogs} />
        )}
      </div>

      {/* Global Exam Launcher Modal */}
      <ExamLauncherModal
        isOpen={launcherModalOpen}
        initialType={launcherType}
        initialSubjectId={launcherSubjectId}
        initialTopic={launcherTopic}
        initialPdfSourceId={launcherPdfSourceId}
        initialError={launcherNotice}
        subjects={SUBJECTS}
        pdfSources={pdfSources}
        onClose={() => setLauncherModalOpen(false)}
        onLaunch={(config) => {
          const error = handleLaunchExam(config);
          if (!error) setLauncherModalOpen(false);
          return error;
        }}
      />
    </div>
  );
}
