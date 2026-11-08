/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { auth, loginWithGoogle, logout, db } from './firebase.ts';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  saveQuestionToFirestore,
  deleteQuestionFromFirestore,
  batchSaveQuestionsToFirestore,
  savePdfSourceToFirestore,
  saveExamResultToFirestore,
  saveAuditLogToFirestore,
  saveUserProfileToFirestore,
  seedInitialFirestoreData,
  isUserAdmin,
} from './utils/firebaseSync.ts';

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
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);

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

  // Synchronize Firebase Auth & Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const isAdmin = isUserAdmin(user.email);
        const profile: UserProfile = {
          id: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Candidate',
          email: user.email || '',
          role: isAdmin ? 'admin' : 'reviewee',
          avatar:
            user.photoURL ||
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          title: isAdmin ? 'Board Review Director' : 'REE Licensure Candidate',
          targetExam: 'REE Licensure Examination',
          enrolledAt: new Date().toISOString(),
        };
        setCurrentUser(profile);
        saveUserProfileToFirestore(profile).catch(() => {});

        if (isAdmin) {
          seedInitialFirestoreData(INITIAL_QUESTIONS, INITIAL_PDF_SOURCES, INITIAL_AUDIT_LOGS);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for real-time Firestore updates when authenticated
  useEffect(() => {
    if (!firebaseUser) return;

    const unsubQuestions = onSnapshot(
      collection(db, 'questions'),
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: Question[] = [];
          snapshot.forEach((d) => loaded.push(d.data() as Question));
          setQuestions(loaded);
        }
      },
      (err) => console.warn('Questions sync warning:', err)
    );

    const unsubSources = onSnapshot(
      collection(db, 'pdfSources'),
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: PdfSource[] = [];
          snapshot.forEach((d) => loaded.push(d.data() as PdfSource));
          setPdfSources(loaded);
        }
      },
      (err) => console.warn('PDF sources sync warning:', err)
    );

    const resultsQuery =
      currentUser.role === 'admin'
        ? collection(db, 'examResults')
        : query(collection(db, 'examResults'), where('userId', '==', firebaseUser.uid));

    const unsubResults = onSnapshot(
      resultsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: ExamResult[] = [];
          snapshot.forEach((d) => loaded.push(d.data() as ExamResult));
          setExamResults(loaded);
        }
      },
      (err) => console.warn('Exam results sync warning:', err)
    );

    return () => {
      unsubQuestions();
      unsubSources();
      unsubResults();
    };
  }, [firebaseUser, currentUser.role]);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error('Google login failed:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setCurrentUser(DEMO_USERS[1]);
      setCurrentView('reviewee-dashboard');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

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
    saveExamResultToFirestore(newResult).catch((err) => console.warn('Save result to Firestore:', err));
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
    batchSaveQuestionsToFirestore(newQuestions).catch((err) =>
      console.warn('Batch save new questions to Firestore:', err)
    );
    savePdfSourceToFirestore(sourcePdf).catch((err) =>
      console.warn('Save PDF to Firestore:', err)
    );
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
    saveAuditLogToFirestore(newLog).catch((err) =>
      console.warn('Save audit log to Firestore:', err)
    );
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
          firebaseUser={firebaseUser}
          onLoginWithGoogle={handleLogin}
          onLogout={handleLogout}
          isFirebaseConnected={true}
        />
      )}

      {currentView !== 'active-exam' && (
        <div className="px-4 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-300 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          {firebaseUser ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Firebase Firestore Active • Authenticated as <strong className="text-white">{firebaseUser.email}</strong> • Cloud Project: <code className="font-mono text-xs bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300">gen-lang-client-0457110273</code>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span>Firebase connected to <strong className="text-white font-mono text-[10px]">gen-lang-client-0457110273</strong>. Click <strong className="text-white">Sign in with Google</strong> to sync examination history across devices, or continue in local demo mode.</span>
            </span>
          )}
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
              saveQuestionToFirestore(q).catch((err) => console.warn('Save question to Firestore:', err));
              handleAddAuditLog('Manual Question Created', `Created Question #${q.id} in ${q.subjectName}.`);
            }}
            onUpdateQuestion={(q) => {
              setQuestions((prev) => prev.map((item) => (item.id === q.id ? q : item)));
              saveQuestionToFirestore(q).catch((err) => console.warn('Save question to Firestore:', err));
              handleAddAuditLog('Question Updated', `Updated parameters for Question #${q.id}.`);
            }}
            onDeleteQuestion={(id) => {
              setQuestions((prev) => prev.filter((item) => item.id !== id));
              deleteQuestionFromFirestore(id).catch((err) => console.warn('Delete question from Firestore:', err));
              handleAddAuditLog('Question Deleted', `Removed Question #${id} from repository.`);
            }}
            onTogglePublish={(id) => {
              setQuestions((prev) =>
                prev.map((item) => {
                  if (item.id !== id) return item;
                  // Unpublishing is always allowed; publishing needs a reviewed answer.
                  if (!item.isPublished && !isReviewedForExams(item)) return item;
                  const updated = { ...item, isPublished: !item.isPublished };
                  saveQuestionToFirestore(updated).catch((err) => console.warn('Save question to Firestore:', err));
                  return updated;
                })
              );
            }}
            onApproveQuestion={(id) => {
              setQuestions((prev) =>
                prev.map((item) => {
                  if (item.id !== id) return item;
                  const updated: Question = { ...item, verificationStatus: 'manual_override' };
                  saveQuestionToFirestore(updated).catch((err) => console.warn('Save question to Firestore:', err));
                  return updated;
                })
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
              savePdfSourceToFirestore(updated).catch((err) => console.warn('Save PDF to Firestore:', err));
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
