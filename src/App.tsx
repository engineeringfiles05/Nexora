/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  INITIAL_QUESTIONS,
  INITIAL_PDF_SOURCES,
  INITIAL_AUDIT_LOGS,
} from './data/seedData.ts';
import { calculateExamScore } from './utils/examEngine.ts';
import {
  getReviewQuestions,
  isApprovedForReviewees,
  isReviewedForExams,
  publishQuestionsToBank,
  type DuplicateDecision,
  reconcileSourceCounts,
  selectExamQuestions,
} from './utils/bank.ts';
import { auth, db } from './firebase.ts';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  saveQuestionToFirestore,
  deleteQuestionFromFirestore,
  batchSaveQuestionsToFirestore,
  savePdfSourceToFirestore,
  saveExamResultToFirestore,
  saveAuditLogToFirestore,
  seedInitialFirestoreData,
  backfillContentCourse,
  migrateAnswerKeys,
} from './utils/firebaseSync.ts';
import { mergeKey, revealAnswers } from './utils/answerKeys.ts';
import {
  cloudQueryPlan,
  cloudReducer,
  describeSyncError,
  emptyCloudState,
  visibleResults,
  type CloudCollection,
} from './utils/session.ts';
import { setIdTokenProvider } from './utils/importerClient.ts';
import { buildProfile, ensureProfile, sessionStartedAt, signOutEverywhere, watchOwnProfile } from './auth/authService.ts';
import { canAccessPlatform, contentCourse, statusOf } from './auth/accountStatus.ts';
import { fetchProfile } from './auth/adminUsers.ts';
import { isAuthView, isView, pathForView, resolveRoute, viewForPath, type SessionState, type View } from './auth/routes.ts';
import { IDLE_TIMEOUT_MS, isIdleExpired, isSessionExpired, readRememberPreference } from './auth/sessionPolicy.ts';

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
import { AccountSettingsView } from './components/AccountSettingsView.tsx';
import { UserManagementView, type UserLogEntry } from './components/users/UserManagementView.tsx';
import { PendingRegistrationsPanel, UserApprovalsView, pendingQueue } from './components/users/UserApprovalsView.tsx';
import { AccountStatusScreen } from './components/auth/AccountStatusScreen.tsx';
import { AuthLoadingScreen, AuthPage, type AuthNotice } from './components/auth/AuthPage.tsx';

// Admin API calls carry the signed-in account's ID token; the server verifies it.
setIdTokenProvider(async () => auth.currentUser?.getIdToken() ?? null);

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

function currentPathView(): View | null {
  return typeof window === 'undefined' ? null : viewForPath(window.location.pathname);
}

export default function App() {
  // ----- Authentication -----
  // Everything except the sign-in pages requires an account. The role comes from the verified
  // sign-in (auth/roles.ts); firestore.rules and the API enforce it again on the server.
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'info'; text: string } | null>(null);
  const [profileWarning, setProfileWarning] = useState<string | null>(null);
  const sessionStart = useRef<number>(NaN);

  // ----- Routing -----
  // The page in the address bar; resolveRoute() decides what this session may actually see.
  const [requestedView, setRequestedView] = useState<View | null>(currentPathView);

  // Signed in: the account's own Firestore data, in memory only and cleared on every account change.
  const [cloud, dispatchCloud] = useReducer(cloudReducer, emptyCloudState());
  const accountRole: UserRole = profile?.role ?? 'reviewee';
  const signedInUid = authStatus === 'signed-in' && firebaseUser ? firebaseUser.uid : null;
  const currentUser = profile as UserProfile; // only read while signed in

  // Admins load answer keys too and see whole questions; reviewees' questions have no answers
  // until they have answered them (utils/answerKeys.ts).
  const questions = useMemo(() => {
    const list = cloud.questions ?? [];
    if (!cloud.questionKeys) return list;
    const keys = new Map(cloud.questionKeys.map((k) => [k.id, k]));
    return list.map((q) => mergeKey(q, keys.get(q.id)));
  }, [cloud.questions, cloud.questionKeys]);
  const storedSources = cloud.pdfSources ?? [];
  const examResults = cloud.examResults ?? [];
  const isSignedInAdmin = Boolean(signedInUid) && accountRole === 'admin';
  const rosterReviewees: UserProfile[] = (cloud.users ?? []).filter((u) => u.role === 'reviewee');

  // Account edits are optimistic; the next Firestore snapshot replaces them with what the
  // server actually holds.
  const scopedSetter =
    <T,>(collection: CloudCollection) =>
    (update: React.SetStateAction<T[]>) => {
      if (!signedInUid) return;
      const fn = typeof update === 'function' ? (update as (prev: T[]) => T[]) : () => update;
      dispatchCloud({ type: 'local', uid: signedInUid, collection, update: fn });
    };
  const setQuestions = scopedSetter<Question>('questions');
  const setPdfSources = scopedSetter<PdfSource>('pdfSources');
  const setExamResults = scopedSetter<ExamResult>('examResults');

  // Cloud write failures are shown, not just logged.
  const reportSaveError = (label: string) => (err: unknown) => {
    console.warn(`${label}:`, err);
    if (signedInUid) dispatchCloud({ type: 'error', uid: signedInUid, collection: 'write', message: describeSyncError('write', err, accountRole) });
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
  /** Identifies this sitting in the reviewee's committed answers. */
  const [examRunId, setExamRunId] = useState('');
  /** Scoring after submission: answers are committed, then the keys are fetched. */
  const [scoring, setScoring] = useState<{ error?: string; retry?: () => void } | null>(null);

  // Modal Launcher State
  const [launcherModalOpen, setLauncherModalOpen] = useState<boolean>(false);
  const [launcherType, setLauncherType] = useState<ExamType>('practice');
  const [launcherSubjectId, setLauncherSubjectId] = useState<string | undefined>(undefined);
  const [launcherTopic, setLauncherTopic] = useState<string | undefined>(undefined);
  const [launcherPdfSourceId, setLauncherPdfSourceId] = useState<string | undefined>(undefined);
  const [launcherNotice, setLauncherNotice] = useState<string | undefined>(undefined);

  // ----- Route decision -----
  const session: SessionState | null =
    authStatus === 'loading'
      ? null
      : authStatus === 'signed-in' && profile
        ? { status: 'signed-in', role: profile.role, restricted: !canAccessPlatform(profile) }
        : { status: 'signed-out' };
  const decision = session ? resolveRoute(requestedView, session) : null;
  // Exam pages need an exam in progress; after a refresh there is none, so go home instead.
  const missingExam =
    decision !== null &&
    ((decision.view === 'active-exam' && !activeExamConfig) || (decision.view === 'exam-result' && !activeResult));
  const currentView: View | null =
    decision && session ? (missingExam ? resolveRoute(null, session).view : decision.view) : null;

  const navigate = useCallback((view: View, options: { replace?: boolean } = {}) => {
    setRequestedView(view);
    if (typeof window === 'undefined') return;
    const path = pathForView(view);
    if (window.location.pathname !== path || window.location.search) {
      if (options.replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    window.scrollTo?.(0, 0);
  }, []);

  // Keep the address bar on the page actually shown (a refused address is replaced).
  const denied = Boolean(decision?.denied);
  useEffect(() => {
    if (!currentView || typeof window === 'undefined') return;
    if (denied) setToast({ tone: 'info', text: 'That page is only available to the NEXORA Academy administrator.' });
    if (currentView !== requestedView) setRequestedView(currentView);
    if (viewForPath(window.location.pathname) !== currentView) window.history.replaceState(null, '', pathForView(currentView));
  }, [currentView, requestedView, denied]);

  // Browser back and forward.
  useEffect(() => {
    const onPop = () => setRequestedView(currentPathView());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ----- Firebase Auth -----
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Every sign-in, sign-out or account switch starts from a clean slate: nothing from the
      // previous account stays on screen.
      dispatchCloud({ type: 'reset', uid: user?.uid ?? null });
      setFirebaseUser(user);
      setActiveExamConfig(null);
      setActiveExamQuestions([]);
      setActiveResult(null);
      setLauncherModalOpen(false);
      setProfileWarning(null);
      if (!user) {
        setProfile(null);
        setAuthStatus('signed-out');
        return;
      }
      setAuthStatus('loading');

      const started = await sessionStartedAt(user);
      sessionStart.current = started;
      if (isSessionExpired(started, readRememberPreference())) {
        setAuthNotice({ tone: 'info', text: 'Your session has expired. Please sign in again.' });
        await signOutEverywhere().catch(() => {});
        return;
      }

      let account: UserProfile;
      try {
        account = await ensureProfile(user);
      } catch (err) {
        // Signed in, but the profile could not be read or saved: carry on with the verified
        // identity (permissions never depend on the profile) and say so.
        console.warn('Profile load failed:', err);
        account = buildProfile(user, null, user.providerData[0]?.providerId);
        setProfileWarning('Your profile could not be loaded from the cloud, so some details may be missing. Try refreshing the page.');
      }
      if (auth.currentUser?.uid !== user.uid) return; // the account changed meanwhile
      // Accounts that aren't approved (pending, rejected, suspended, deactivated) stay signed
      // in but see only their account status page (auth/routes.ts); firestore.rules refuses
      // them all review material, so nothing else can be reached.
      setProfile(account);
      setAuthNotice(null);
      setAuthStatus('signed-in');

      if (account.role === 'admin') {
        // Seed an empty bank, then tag material from before courses existed as REE.
        // Answers come out of question documents first: question writes that still carry them
        // are refused by firestore.rules.
        seedInitialFirestoreData(INITIAL_QUESTIONS, INITIAL_PDF_SOURCES, INITIAL_AUDIT_LOGS)
          .then(() => migrateAnswerKeys())
          .then(() => backfillContentCourse())
          .catch((err) => console.warn('Course backfill skipped:', err));
      }
    });
    return () => unsubscribe();
  }, []);

  // Session limits on top of Firebase's own token handling: see auth/sessionPolicy.ts.
  const inExamRef = useRef(false);
  inExamRef.current = currentView === 'active-exam';
  useEffect(() => {
    if (authStatus !== 'signed-in') return;
    let lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const remember = readRememberPreference();
      const idle = isIdleExpired(lastActivity, remember, inExamRef.current);
      const tooOld = !inExamRef.current && isSessionExpired(sessionStart.current, remember);
      if (!idle && !tooOld) return;
      setAuthNotice({
        tone: 'info',
        text: idle
          ? `You were signed out after ${Math.round(IDLE_TIMEOUT_MS / 60000)} minutes of inactivity. Sign in again to continue.`
          : 'Your session has expired. Please sign in again.',
      });
      signOutEverywhere().catch(() => {});
    }, 60_000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [authStatus]);

  // The account's own profile, live: approval opens the dashboard at once; rejection,
  // suspension or deactivation switches to the status page at once; deletion signs out.
  useEffect(() => {
    if (!signedInUid || !firebaseUser) return;
    const user = firebaseUser;
    return watchOwnProfile(
      user,
      (next) => {
        if (auth.currentUser?.uid !== user.uid) return;
        if (!next) {
          // The profile was deleted by the administrator.
          if (user.uid && accountRoleRef.current !== 'admin') {
            setAuthNotice({ tone: 'error', text: 'This account has been removed. Contact NEXORA Academy for help.' });
            signOutEverywhere().catch(() => {});
          }
          return;
        }
        setProfile((prev) => {
          if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
          if (prev && !canAccessPlatform(prev) && canAccessPlatform(next)) {
            setToast({ tone: 'success', text: `Your account has been approved. Welcome to NEXORA Academy, ${next.name.split(/\s+/)[0]}!` });
          }
          if (prev && canAccessPlatform(prev) && !canAccessPlatform(next)) {
            setActiveExamConfig(null);
            setLauncherModalOpen(false);
          }
          return next;
        });
      },
      (err) => console.warn('Profile listener error:', err)
    );
  }, [signedInUid, firebaseUser]);
  const accountRoleRef = useRef<UserRole>('reviewee');
  accountRoleRef.current = accountRole;
  const accountCourse = profile?.course ?? null;
  const restricted = profile ? !canAccessPlatform(profile) : false;

  // Real-time Firestore data for the signed-in account. Queries follow firestore.rules for the
  // account's role (reviewees can only list published questions and public sources of their
  // own course, and their own results); empty results replace old data, and failures are shown.
  useEffect(() => {
    // Accounts that aren't approved load nothing (the rules would refuse it anyway).
    if (!signedInUid || restricted) return;
    const plan = cloudQueryPlan(accountRole, signedInUid, accountCourse);
    // Without a course there is nothing to list: clear whatever a previous course showed.
    for (const name of ['questions', 'pdfSources'] as const) {
      if (!(name in plan)) dispatchCloud({ type: 'snapshot', uid: signedInUid, collection: name, docs: [] });
    }
    const unsubscribes = (Object.keys(plan) as CloudCollection[]).map((name) => {
      const filters = plan[name];
      const ref = filters ? query(collection(db, name), ...filters.map((f) => where(f.field, '==', f.value))) : collection(db, name);
      return onSnapshot(
        ref,
        (snapshot) => dispatchCloud({ type: 'snapshot', uid: signedInUid, collection: name, docs: snapshot.docs.map((d) => d.data()) }),
        (err) => {
          console.warn(`${name} sync error:`, err);
          dispatchCloud({ type: 'error', uid: signedInUid, collection: name, message: describeSyncError(name, err, accountRole) });
        }
      );
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [signedInUid, accountRole, accountCourse, restricted]);

  // Admin notification when someone registers while the dashboard is open.
  const knownPending = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!isSignedInAdmin || !cloud.users) {
      knownPending.current = null;
      return;
    }
    const queue = pendingQueue(cloud.users);
    const ids = new Set(queue.map((u) => u.id));
    if (knownPending.current) {
      const fresh = queue.filter((u) => !knownPending.current!.has(u.id));
      if (fresh.length === 1) setToast({ tone: 'info', text: `New registration: ${fresh[0]!.name} (${fresh[0]!.email}) is waiting for your approval.` });
      else if (fresh.length > 1) setToast({ tone: 'info', text: `${fresh.length} new registrations are waiting for your approval.` });
    }
    knownPending.current = ids;
  }, [isSignedInAdmin, cloud.users]);

  // Signing out ends the Firebase session and returns to the sign-in page.
  const handleLogout = async () => {
    try {
      await signOutEverywhere();
      setAuthNotice({ tone: 'success', text: 'You have been signed out.' });
      navigate('login', { replace: true });
    } catch (err) {
      console.error('Logout failed:', err);
      setToast({ tone: 'info', text: 'Sign-out failed. Check your connection and try again.' });
    }
  };

  const handleNavigate = (view: string) => {
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
    // Admin pages are refused for reviewees by resolveRoute(), however they are reached.
    if (isView(view)) navigate(view);
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

    // "All questions" becomes the actual number, so results and history show the real count.
    setActiveExamConfig({ ...config, questionCount: selection.questions.length });
    setActiveExamQuestions(selection.questions);
    setExamRunId(`exam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    setScoring(null);
    navigate('active-exam');
    return null;
  };

  // Instant feedback: the answer is committed first, then its key is fetched (and the choice locks).
  const handleRevealAnswer = async (q: Question, answer: string): Promise<Question> => {
    const [revealed] = await revealAnswers(currentUser.id, examRunId, [q], { [q.id]: answer });
    setActiveExamQuestions((prev) => prev.map((x) => (x.id === q.id ? revealed! : x)));
    return revealed!;
  };

  // Finish exam handler: commit the answers, fetch the keys, then score.
  const handleFinishExam = async (
    userAnswers: Record<string, string>,
    flaggedIds: string[],
    timeConsumedSeconds: number
  ) => {
    if (!activeExamConfig) return;
    setScoring({});
    let revealedQuestions: Question[];
    try {
      revealedQuestions = await revealAnswers(currentUser.id, examRunId || `exam-${Date.now()}`, activeExamQuestions, userAnswers);
    } catch (err) {
      console.warn('Scoring failed:', err);
      setScoring({
        error: (err as Error)?.message || 'Your answers could not be checked. Check your connection and try again.',
        retry: () => void handleFinishExam(userAnswers, flaggedIds, timeConsumedSeconds),
      });
      return;
    }
    setScoring(null);
    setActiveExamQuestions(revealedQuestions);

    const scoreResult = calculateExamScore(revealedQuestions, userAnswers);

    const newResult: ExamResult = {
      id: `res-${Date.now()}`,
      examId: examRunId || `exam-${Date.now()}`,
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
      questionSnapshots: revealedQuestions,
      examConfig: activeExamConfig,
    };

    setExamResults((prev) => [...prev, newResult]);
    saveExamResultToFirestore(newResult).catch(reportSaveError('Save result to Firestore'));
    setActiveResult(newResult);
    navigate('exam-result');
  };

  // Open a saved result with the questions and settings it was taken with.
  const handleViewResult = (res: ExamResult) => {
    setActiveResult(res);
    setActiveExamConfig(res.examConfig ?? null);
    setActiveExamQuestions(getReviewQuestions(res, questions));
    navigate('exam-result');
  };

  // Admin: Publish new extracted questions
  const handlePublishQuestions = (newQuestions: Question[], sourcePdf: PdfSource, decisions: Record<string, DuplicateDecision> = {}) => {
    const published = publishQuestionsToBank(questions, storedSources, newQuestions, sourcePdf, decisions);
    setQuestions(published.questions);
    setPdfSources(published.sources);
    // Save the questions as published (with the source ID they were filed under), not the staged
    // copies, plus bank questions the admin chose to replace with the imported version.
    const added = published.questions.slice(questions.length);
    const changed = [...added, ...published.replaced];
    const filedUnder = changed[0]?.sourcePdfId;
    const savedSource = published.sources.find((s) => filedUnder && s.id === filedUnder) ?? sourcePdf;
    if (changed.length > 0) {
      batchSaveQuestionsToFirestore(changed).catch(reportSaveError('Batch save new questions to Firestore'));
      savePdfSourceToFirestore(savedSource).catch(reportSaveError('Save PDF to Firestore'));
    }
    return { added: added.length, skipped: published.skipped.length, replaced: published.replaced.length };
  };

  // Admin audit log adder
  const handleAddAuditLog = (action: string, details: string, badge?: string, target?: UserLogEntry['target']) => {
    const now = new Date();
    const newLog: AuditLog = {
      id: `log-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`, // unique within a bulk action
      adminName: currentUser.name,
      action,
      details,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: now.toISOString(),
      category: target || badge === 'Users' || badge === 'Settings' ? 'users' : 'content',
      ...(badge ? { badge } : {}),
      ...(target ? { targetUserId: target.id, targetUserName: target.name, targetUserEmail: target.email } : {}),
    };
    // Recorded in Firestore (auditLogs) for the record; the app has no page that lists it.
    saveAuditLogToFirestore(newLog).catch(reportSaveError('Save audit log to Firestore'));
  };

  // ----- Signed out, or still checking the session -----
  if (authStatus === 'loading' || !currentView) {
    return <AuthLoadingScreen label={firebaseUser ? 'Signing you in…' : 'Loading NEXORA Academy…'} />;
  }
  if (authStatus === 'signed-out' || !profile || !firebaseUser || isAuthView(currentView)) {
    if (!isAuthView(currentView)) return <AuthLoadingScreen />;
    return (
      <AuthPage
        view={currentView}
        onNavigate={(view) => navigate(view)}
        notice={authNotice}
        onDismissNotice={() => setAuthNotice(null)}
        onRegistered={(name, status) =>
          // A new account waits for approval: its status page says so instead.
          status !== 'pending' &&
          setToast({
            tone: 'success',
            text: `Welcome to NEXORA Academy, ${name.trim().split(/\s+/)[0]}! Your reviewee account has been created. We also sent a link to verify your email address.`,
          })
        }
      />
    );
  }

  // ----- Signed in, but not approved: the status page is all there is -----
  if (currentView === 'account-status') {
    return (
      <>
        <AccountStatusScreen
          profile={currentUser}
          onLogout={handleLogout}
          onCheckStatus={async () => {
            const stored = await fetchProfile(firebaseUser.uid);
            if (!stored) return false;
            const next = buildProfile(firebaseUser, stored, firebaseUser.providerData[0]?.providerId);
            const changed = statusOf(next) !== statusOf(currentUser);
            if (changed) setProfile(next);
            return changed;
          }}
        />
        {toast && (
          <div role="status" className="fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm rounded-2xl border border-emerald-700/50 bg-slate-900/95 px-4 py-3 shadow-2xl text-sm text-slate-100">
            {toast.text}
          </div>
        )}
      </>
    );
  }

  // Reviewee screens only show the current person's own results.
  const myResults = visibleResults(currentUser, examResults);
  const pendingApprovals = isSignedInAdmin && cloud.users ? pendingQueue(cloud.users).length : 0;
  const logUserAction = (entry: UserLogEntry) => handleAddAuditLog(entry.action, entry.details, entry.badge, entry.target);
  const plannedCollections = signedInUid ? (Object.keys(cloudQueryPlan(accountRole, signedInUid, accountCourse)) as CloudCollection[]) : [];
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
          pendingVerificationCount={pendingVerificationCount}
          pendingApprovals={pendingApprovals}
          onLogout={handleLogout}
        />
      )}

      {currentView !== 'active-exam' && (
        <div className="px-4 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-300 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Securely signed in as <strong className="text-white">{firebaseUser.email}</strong> • Your progress is saved to your account
          </span>
          {cloudLoading && syncErrors.length === 0 && <span className="text-slate-400">Loading your data…</span>}
        </div>
      )}

      {currentView !== 'active-exam' && profileWarning && (
        <div role="alert" className="px-4 py-2 bg-amber-950/60 border-b border-amber-800 text-xs text-amber-100 text-center">
          {profileWarning}
        </div>
      )}

      {currentView !== 'active-exam' && currentUser.role === 'reviewee' && !currentUser.course && currentView !== 'account' && !profileWarning && (
        <div className="px-4 py-2 bg-indigo-950/60 border-b border-indigo-800 text-xs text-indigo-100 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          <span>Tell us which board exam you are reviewing for (REE or RME) to complete your profile.</span>
          <button onClick={() => navigate('account')} className="font-semibold underline underline-offset-2">
            Choose course
          </button>
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
            onFinishExam={(answers, flags, seconds) => void handleFinishExam(answers, flags, seconds)}
            onRevealAnswer={handleRevealAnswer}
            onExitExam={() => navigate('reviewee-dashboard')}
          />
        )}

        {currentView === 'active-exam' && scoring && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Checking your answers">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 text-center space-y-4">
              {scoring.error ? (
                <>
                  <p className="text-sm text-rose-200">{scoring.error}</p>
                  <p className="text-xs text-slate-400">Your answers are kept. Nothing is lost by trying again.</p>
                  <button onClick={scoring.retry} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white">
                    Try again
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-200 flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" aria-hidden /> Checking your answers…
                </p>
              )}
            </div>
          </div>
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
            onBackToDashboard={() => navigate('reviewee-dashboard')}
          />
        )}

        {/* ADMINISTRATOR VIEWS */}
        {currentView === 'admin-dashboard' && cloud.users && (
          <PendingRegistrationsPanel users={cloud.users} onLog={logUserAction} onOpenApprovals={() => navigate('user-approvals')} />
        )}

        {currentView === 'user-approvals' && (
          <UserApprovalsView
            users={cloud.users ?? []}
            loading={isSignedInAdmin && cloud.users === null && !cloud.errors.users}
            error={cloud.errors.users}
            admin={currentUser}
            onLog={logUserAction}
          />
        )}

        {currentView === 'admin-dashboard' && (
          <AdminDashboard
            adminUser={currentUser}
            questions={questions}
            pdfSources={pdfSources}
            examResults={examResults}
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
              const before = pdfSources.find((p) => p.id === updated.id);
              setPdfSources((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p))
              );
              savePdfSourceToFirestore(updated).catch(reportSaveError('Save PDF to Firestore'));
              if (before && contentCourse(before) !== contentCourse(updated)) {
                // The set's questions follow it, so reviewees of the new course get all of them.
                const moved = questions.filter((q) => q.sourcePdfId === updated.id).map((q) => ({ ...q, course: contentCourse(updated) }));
                setQuestions((prev) => prev.map((q) => moved.find((m) => m.id === q.id) ?? q));
                if (moved.length) batchSaveQuestionsToFirestore(moved).catch(reportSaveError('Save question courses to Firestore'));
                handleAddAuditLog('Question Set Course Changed', `"${updated.filename}" and its ${moved.length} question${moved.length === 1 ? '' : 's'}: ${contentCourse(before)} → ${contentCourse(updated)}.`, 'Course');
              } else {
                handleAddAuditLog('PDF Permissions Updated', `Updated permissions for "${updated.filename}".`);
              }
            }}
            onNavigateToImporter={() => navigate('pdf-importer')}
            onNavigateToQuiz={(pdfId) => {
              // The administrator takes the quiz as themselves.
              navigate('pdf-quiz-generator');
              handleOpenLauncher('pdf_quiz', undefined, pdfId);
            }}
          />
        )}

        {currentView === 'reviewees-roster' && (
          <RevieweeRosterView
            reviewees={rosterReviewees}
            examResults={examResults}
            loading={isSignedInAdmin && cloud.users === null && !cloud.errors.users}
            error={cloud.errors.users}
          />
        )}

        {currentView === 'user-management' && (
          <UserManagementView
            users={cloud.users ?? []}
            loading={isSignedInAdmin && cloud.users === null && !cloud.errors.users}
            error={cloud.errors.users}
            examResults={examResults}
            subjects={SUBJECTS}
            admin={currentUser}
            onLog={logUserAction}
            onOpenApprovals={() => navigate('user-approvals')}
          />
        )}

        {currentView === 'account' && (
          <AccountSettingsView
            profile={currentUser}
            firebaseUser={firebaseUser}
            onProfileUpdated={setProfile}
            onLogout={handleLogout}
          />
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm rounded-2xl border border-emerald-700/50 bg-slate-900/95 backdrop-blur px-4 py-3 shadow-2xl text-sm text-slate-100 flex items-start gap-3"
        >
          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${toast.tone === 'success' ? 'bg-emerald-400' : 'bg-indigo-400'}`} />
          <span className="flex-1 leading-relaxed">{toast.text}</span>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white text-xs font-semibold">
            Close
          </button>
        </div>
      )}

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
