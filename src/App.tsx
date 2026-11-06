/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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

  const [questions, setQuestions] = useState<Question[]>(INITIAL_QUESTIONS);
  const [pdfSources, setPdfSources] = useState<PdfSource[]>(INITIAL_PDF_SOURCES);
  const [examResults, setExamResults] = useState<ExamResult[]>(INITIAL_EXAM_RESULTS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);

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

  const handleOpenLauncher = (type: ExamType, subjectId?: string, pdfSourceId?: string, topic?: string) => {
    setLauncherType(type);
    setLauncherSubjectId(subjectId);
    setLauncherTopic(topic);
    setLauncherPdfSourceId(pdfSourceId);
    setLauncherModalOpen(true);
  };

  // Launching an exam session
  const handleLaunchExam = (config: ExamConfig) => {
    setLauncherModalOpen(false);

    // Filter candidate questions based on config
    let pool = questions.filter((q) => q.isPublished);

    if (config.subjectId && config.subjectId !== 'all') {
      pool = pool.filter((q) => q.subjectId === config.subjectId);
    }
    if (config.topic && config.topic !== 'all') {
      pool = pool.filter((q) => q.topic.toLowerCase() === config.topic?.toLowerCase());
    }
    if (config.pdfSourceId) {
      pool = pool.filter((q) => q.sourcePdfId === config.pdfSourceId);
    }
    if (config.difficulty && config.difficulty !== 'mixed') {
      pool = pool.filter((q) => q.difficulty === config.difficulty);
    }

    // If pool is empty or smaller than requested count, pull from published bank with fallback
    if (pool.length === 0) {
      pool = questions.filter((q) => q.isPublished);
    }

    // Shuffle if requested
    let selected = [...pool];
    if (config.randomizeQuestions) {
      selected.sort(() => Math.random() - 0.5);
    }

    // Limit to requested count
    selected = selected.slice(0, Math.min(config.questionCount, selected.length));

    // Randomize choices if requested
    if (config.randomizeChoices) {
      selected = selected.map((q) => ({
        ...q,
        options: [...q.options].sort(() => Math.random() - 0.5),
      }));
    }

    setActiveExamConfig(config);
    setActiveExamQuestions(selected);
    setCurrentView('active-exam');
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
    };

    setExamResults((prev) => [...prev, newResult]);
    setActiveResult(newResult);
    setCurrentView('exam-result');
  };

  // Admin: Publish new extracted questions
  const handlePublishQuestions = (newQuestions: Question[], sourcePdf: PdfSource) => {
    // Add new questions marked as published
    const published = newQuestions.map((q) => ({
      ...q,
      isPublished: true,
      sourcePdfId: sourcePdf.id,
      sourcePdfName: sourcePdf.filename,
    }));

    setQuestions((prev) => [...prev, ...published]);

    // Update or add pdf source
    setPdfSources((prev) => {
      const idx = prev.findIndex((p) => p.id === sourcePdf.id || p.filename === sourcePdf.filename);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = sourcePdf;
        return copy;
      }
      return [sourcePdf, ...prev];
    });
  };

  // Admin audit log adder
  const handleAddAuditLog = (action: string, details: string, badge?: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
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
            onViewResult={(res) => {
              setActiveResult(res);
              // Find matching questions
              const matched = questions.filter((q) => res.userAnswers[q.id] !== undefined);
              setActiveExamQuestions(matched.length > 0 ? matched : questions.slice(0, res.totalQuestions));
              setCurrentView('exam-result');
            }}
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
              handleLaunchExam(config);
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
                    onClick={() => {
                      setActiveResult(exam);
                      const matched = questions.filter((q) => exam.userAnswers[q.id] !== undefined);
                      setActiveExamQuestions(matched.length > 0 ? matched : questions.slice(0, exam.totalQuestions));
                      setCurrentView('exam-result');
                    }}
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
              if (activeExamConfig) {
                handleLaunchExam(activeExamConfig);
              } else {
                handleOpenLauncher(activeResult.type);
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
                prev.map((item) => (item.id === id ? { ...item, isPublished: !item.isPublished } : item))
              );
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
        subjects={SUBJECTS}
        pdfSources={pdfSources}
        onClose={() => setLauncherModalOpen(false)}
        onLaunch={handleLaunchExam}
      />
    </div>
  );
}
