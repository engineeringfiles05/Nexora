/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
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
  isApprovedForReviewees,
  isReviewedForExams,
  publishQuestionsToBank,
  reconcileSourceCounts,
  selectExamQuestions,
} from './utils/bank.ts';
import { isRecordArray, useDemoPersistentState } from './utils/persistence.ts';
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
import {
  canSwitchDemoRole,
  cloudQueryPlan,
  cloudReducer,
  describeSyncError,
  emptyCloudState,
  sortAuditLogs,
  visibleResults,
  type CloudCollection,
} from './utils/session.ts';

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
  // Demo mode (signed out): sample data kept in this browser.
  const [demoQuestions, setDemoQuestions] = useDemoPersistentState<Question[]>('questions', INITIAL_QUESTIONS, isRecordArray<Question>, handleSaved);
  const [demoSources, setDemoSources] = useDemoPersistentState<PdfSource[]>('sources', INITIAL_PDF_SOURCES, isRecordArray<PdfSource>, handleSaved);
  const [demoResults, setDemoResults] = useDemoPersistentState<ExamResult[]>('results', INITIAL_EXAM_RESULTS, isRecordArray<ExamResult>, handleSaved);
  const [demoAudit, setDemoAudit] = useDemoPersistentState<AuditLog[]>('audit', INITIAL_AUDIT_LOGS, isRecordArray<AuditLog>, handleSaved);

  // Signed in: the account's own Firestore data, in memory only and cleared on every account change.
  const [cloud, dispatchCloud] = useReducer(cloudReducer, emptyCloudState());
  const [accountRole, setAccountRole] = useState<UserRole>('reviewee');
  const signedInUid = firebaseUser?.uid ?? null;

  const questions = signedInUid ? cloud.questions ?? [] : demoQuestions;
  const storedSources = signedInUid ? cloud.pdfSources ?? [] : demoSources;
  const examResults = signedInUid ? cloud.examResults ?? [] : demoResults;
  // Admin-only collections: reviewees never query them, so they stay null (shown as empty).
  const auditLogs = signedInUid ? sortAuditLogs(cloud.auditLogs ?? []) : demoAudit;
  const isSignedInAdmin = Boolean(signedInUid) && accountRole === 'admin';
  const rosterReviewees: UserProfile[] = signedInUid
    ? (cloud.users ?? []).filter((u) => u.role === 'reviewee')
    : [DEMO_USERS[1]]; // the sample roster exists only in demo mode

  // Setters write to whichever data set is active. Account edits are optimistic; the next
  // Firestore snapshot replaces them with what the server actually holds.
  const scopedSetter =
    <T,>(collection: CloudCollection, setDemo: React.Dispatch<React.SetStateAction<T[]>>) =>
    (update: React.SetStateAction<T[]>) => {
      if (!signedInUid) return setDemo(update);
      const fn = typeof update === 'function' ? (update as (prev: T[]) => T[]) : () => update;
      dispatchCloud({ type: 'local', uid: signedInUid, collection, update: fn });
    };
  const setQuestions = scopedSetter<Question>('questions', setDemoQuestions);
  const setPdfSources = scopedSetter<PdfSource>('pdfSources', setDemoSources);
  const setExamResults = scopedSetter<ExamResult>('examResults', setDemoResults);
  const setAuditLogs = scopedSetter<AuditLog>('auditLogs', setDemoAudit);

  // Cloud write failures are shown, not just logged.
  const reportSaveError = (label: string) => (err: unknown) => {
    console.warn(`${label}:`, err);
    if (signedInUid) dispatchCloud({ type: 'error', uid: signedInUid, collection: 'write', message: describeSyncError('write', err) });
  };

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
      // Every sign-in, sign-out or account switch starts from a clean slate: nothing from the
      // previous account (or from demo mode) stays on screen.
      dispatchCloud({ type: 'reset', uid: user?.uid ?? null });
      setFirebaseUser(user);
      setActiveExamConfig(null);
      setActiveExamQuestions([]);
      setActiveResult(null);
      setLauncherModalOpen(false);
      if (!user) {
        setAccountRole('reviewee');
        setCurrentUser(DEMO_USERS[1]);
        setCurrentView('reviewee-dashboard');
      }
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
        setAccountRole(profile.role);
        setCurrentUser(profile);
        setCurrentView(isAdmin ? 'admin-dashboard' : 'reviewee-dashboard');
        saveUserProfileToFirestore(profile).catch(() => {});

        if (isAdmin) {
          seedInitialFirestoreData(INITIAL_QUESTIONS, INITIAL_PDF_SOURCES, INITIAL_AUDIT_LOGS);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Firestore data for the signed-in account. Queries follow firestore.rules for the
  // account's role (reviewees can only list published questions, public sources and their own
  // results); empty results replace old data, and failures are shown to the user.
  useEffect(() => {
    if (!signedInUid) return;
    const plan = cloudQueryPlan(accountRole, signedInUid);
    const unsubscribes = (Object.keys(plan) as CloudCollection[]).map((name) => {
      const filter = plan[name];
      const ref = filter ? query(collection(db, name), where(filter.field, '==', filter.value)) : collection(db, name);
      return onSnapshot(
        ref,
        (snapshot) => dispatchCloud({ type: 'snapshot', uid: signedInUid, collection: name, docs: snapshot.docs.map((d) => d.data()) }),
        (err) => {
          console.warn(`${name} sync error:`, err);
          dispatchCloud({ type: 'error', uid: signedInUid, collection: name, message: describeSyncError(name, err) });
        }
      );
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [signedInUid, accountRole]);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error('Google login failed:', err);
    }
  };

  // The auth listener clears account data and returns to the demo reviewee.
  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleResetDemoData = () => {
    setDemoQuestions(INITIAL_QUESTIONS);
    setDemoSources(INITIAL_PDF_SOURCES);
    setDemoResults(INITIAL_EXAM_RESULTS);
    setDemoAudit(INITIAL_AUDIT_LOGS);
    setConfirmingReset(false);
    setCurrentView(currentUser.role === 'admin' ? 'admin-dashboard' : 'reviewee-dashboard');
  };

  // Demo role switching. A signed-in account keeps its own identity and permissions.
  const handleSwitchRole = (role: UserRole) => {
    if (!canSwitchDemoRole(Boolean(firebaseUser))) return;
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
    saveExamResultToFirestore(newResult).catch(reportSaveError('Save result to Firestore'));
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
    // Save the questions as published (with the source ID they were filed under), not the staged copies.
    const added = published.questions.slice(questions.length);
    const savedSource = published.sources.find((s) => added[0] && s.id === added[0].sourcePdfId) ?? sourcePdf;
    if (added.length > 0) {
      batchSaveQuestionsToFirestore(added).catch(reportSaveError('Batch save new questions to Firestore'));
      savePdfSourceToFirestore(savedSource).catch(reportSaveError('Save PDF to Firestore'));
    }
    return { added: added.length, skipped: published.skipped.length };
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
    saveAuditLogToFirestore(newLog).catch(reportSaveError('Save audit log to Firestore'));
  };

  // Reviewee screens only show the current person's own results.
  const myResults = visibleResults(currentUser, examResults);
  const plannedCollections = signedInUid ? (Object.keys(cloudQueryPlan(accountRole, signedInUid)) as CloudCollection[]) : [];
  const cloudLoading = plannedCollections.some((name) => cloud[name] === null);
  const syncErrors = signedInUid ? Object.entries(cloud.errors) : [];

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
          onSelectUser={(u) => {
            if (canSwitchDemoRole(Boolean(firebaseUser))) setCurrentUser(u);
          }}
          canSwitchRole={canSwitchDemoRole(Boolean(firebaseUser))}
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
          {cloudLoading && syncErrors.length === 0 && <span className="text-slate-400">Loading your data…</span>}
        </div>
      )}

      {currentView !== 'active-exam' && syncErrors.length > 0 && (
        <div role="alert" className="px-4 py-2 bg-rose-950/70 border-b border-rose-800 text-xs text-rose-100 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
          {syncErrors.map(([key, message]) => (
            <span key={key}>{message}</span>
          ))}
          {cloud.errors.write && signedInUid && (
            <button onClick={() => dispatchCloud({ type: 'dismiss', uid: signedInUid, key: 'write' })} className="underline font-semibold">
              Dismiss
            </button>
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
            examResults={myResults}
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
              {myResults.length === 0 && <p className="text-sm text-slate-400">No examinations taken yet.</p>}
              {myResults.map((exam) => (
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
              saveQuestionToFirestore(q).catch(reportSaveError('Save question to Firestore'));
              handleAddAuditLog('Manual Question Created', `Created Question #${q.id} in ${q.subjectName}.`);
            }}
            onUpdateQuestion={(q) => {
              setQuestions((prev) => prev.map((item) => (item.id === q.id ? q : item)));
              saveQuestionToFirestore(q).catch(reportSaveError('Save question to Firestore'));
              handleAddAuditLog('Question Updated', `Updated parameters for Question #${q.id}.`);
            }}
            onDeleteQuestion={(id) => {
              setQuestions((prev) => prev.filter((item) => item.id !== id));
              deleteQuestionFromFirestore(id).catch(reportSaveError('Delete question from Firestore'));
              handleAddAuditLog('Question Deleted', `Removed Question #${id} from repository.`);
            }}
            onTogglePublish={(id) => {
              setQuestions((prev) =>
                prev.map((item) => {
                  if (item.id !== id) return item;
                  // Unpublishing is always allowed; publishing needs a reviewed answer and,
                  // for imported questions, an admin's approval against the PDF.
                  if (!item.isPublished && (!isReviewedForExams(item) || !isApprovedForReviewees(item))) return item;
                  const updated = { ...item, isPublished: !item.isPublished };
                  saveQuestionToFirestore(updated).catch(reportSaveError('Save question to Firestore'));
                  return updated;
                })
              );
            }}
            onApproveQuestion={(id) => {
              setQuestions((prev) =>
                prev.map((item) => {
                  if (item.id !== id) return item;
                  const updated: Question = { ...item, verificationStatus: 'manual_override' };
                  saveQuestionToFirestore(updated).catch(reportSaveError('Save question to Firestore'));
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
              savePdfSourceToFirestore(updated).catch(reportSaveError('Save PDF to Firestore'));
              handleAddAuditLog('PDF Permissions Updated', `Updated permissions for "${updated.filename}".`);
            }}
            onNavigateToImporter={() => setCurrentView('pdf-importer')}
            onNavigateToQuiz={(pdfId) => {
              // Demo mode switches to the sample reviewee; a signed-in admin takes it as themselves.
              if (canSwitchDemoRole(Boolean(firebaseUser))) setCurrentUser(DEMO_USERS[1]);
              setCurrentView('pdf-quiz-generator');
              handleOpenLauncher('pdf_quiz', undefined, pdfId);
            }}
          />
        )}

        {currentView === 'reviewees-roster' && (
          <RevieweeRosterView
            reviewees={rosterReviewees}
            examResults={examResults}
            loading={isSignedInAdmin && cloud.users === null && !cloud.errors.users}
            error={signedInUid ? cloud.errors.users : undefined}
            isDemo={!signedInUid}
          />
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
