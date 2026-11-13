/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI PDF Question Importer. Several questionnaires can be queued; each is extracted (text layer,
 * cross-checked against the page image, scanned pages read from their image), optionally
 * answered and solved by AI, and saved as drafts in Firestore (utils/importQueue.ts). Nothing
 * reaches reviewees until the administrator approves and publishes it into the Question Bank.
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FileUp,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Split,
  X,
} from 'lucide-react';
import type { PdfSource, Question } from '../types/index.ts';
import { countDuplicateDecisions, findDuplicates, isReviewedForExams, type DuplicateDecision } from '../utils/bank.ts';

const DECISION_LABEL: Record<DuplicateDecision, string> = { skip: 'Skip it', replace: 'Replace the bank copy', keep: 'Keep both' };
import { buildExtractionReport, refreshQuestionAssessment, SUBJECT_NAMES } from '../utils/questionExtractor.ts';
import {
  approvalBlocker,
  approveMany,
  approveQuestion,
  issuesToConfirm,
  planBulkApproval,
  type BulkApprovalPlan,
  newManualQuestion,
  rejectQuestion,
  reopenQuestion,
  saveEdit,
  setAnswer,
} from '../utils/importReview.ts';
import { hasIdTokenProvider, readSessionToken, writeSessionToken } from '../utils/importerClient.ts';
import * as importQueue from '../utils/importQueue.ts';
import { totals as importTotals, type ImportSession } from '../utils/importSessions.ts';
import { parseSolutionSections } from '../utils/solutionFormat.ts';
import { PdfPageViewer, type ViewerHighlight } from './importer/PdfPageViewer.tsx';
import { QuestionReviewCard, STATUS_STYLE } from './importer/QuestionReviewCard.tsx';
import { QuestionEditor } from './importer/QuestionEditor.tsx';
import { ExtractionReportPanel } from './importer/ExtractionReportPanel.tsx';
import { ExamPreview } from './importer/ExamPreview.tsx';
import { ImportDashboard } from './importer/ImportDashboard.tsx';
import { ImportUploader, type UploadSettings } from './importer/ImportUploader.tsx';
import { ImportQueueList } from './importer/ImportQueueList.tsx';

interface Props {
  existingQuestions: Question[];
  pdfSources: PdfSource[];
  onPublishQuestions: (
    newQuestions: Question[],
    sourcePdf: PdfSource,
    decisions?: Record<string, DuplicateDecision>
  ) => { added: number; skipped: number; replaced?: number } | void;
  onAddAuditLog: (action: string, details: string, badge?: string) => void;
}

type Filter = 'all' | 'attention' | 'incomplete' | 'needs_review' | 'verified' | 'approved' | 'rejected' | 'unanswered' | 'duplicates' | 'selected';

const REPORT_LABEL = { verified: 'Verified', needs_review: 'Needs review', incomplete: 'Incomplete', failed: 'Failed' } as const;
const REPORT_STYLE = {
  verified: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  needs_review: 'bg-amber-950 text-amber-300 border-amber-800/60',
  incomplete: 'bg-rose-950 text-rose-300 border-rose-800/60',
  failed: 'bg-rose-900 text-rose-100 border-rose-600',
} as const;

const SELECTED_KEY = 'nexora.importer.session';
const readSelected = () => {
  try {
    return sessionStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};
const writeSelected = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(SELECTED_KEY, id);
    else sessionStorage.removeItem(SELECTED_KEY);
  } catch {
    // Storage blocked: the open import just isn't remembered.
  }
};

export const PdfImporterView: React.FC<Props> = ({ existingQuestions, pdfSources, onPublishQuestions, onAddAuditLog }) => {
  const store = useSyncExternalStore(importQueue.subscribe, importQueue.getState, importQueue.getState);
  const [token, setToken] = useState<string>(() => readSessionToken());
  const [sessionId, setSessionId] = useState<string | null>(readSelected);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<{ files: File[]; settings: UploadSettings; names: string[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ImportSession | null>(null);
  const [confirmReextract, setConfirmReextract] = useState(false);

  // ----- review UI state -----
  const [tab, setTab] = useState<'review' | 'report' | 'preview'>('review');
  const [mobilePanel, setMobilePanel] = useState<'pdf' | 'questions'>('questions');
  const [viewerPage, setViewerPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [onlyThisPage, setOnlyThisPage] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ question: Question; isNew: boolean } | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<Question | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<{ what: string; plan: BulkApprovalPlan } | null>(null);
  const [solutionFor, setSolutionFor] = useState<Question | null>(null);

  useEffect(() => {
    void importQueue.load();
  }, []);

  useEffect(() => {
    importQueue.setBank(existingQuestions);
  }, [existingQuestions]);

  useEffect(() => {
    writeSessionToken(token);
  }, [token]);

  const server = store.server;
  const aiAvailable = Boolean(server?.imageReading);
  const tokenRequired = Boolean(server?.adminTokenRequired) && !(server?.adminSignIn && hasIdTokenProvider());
  const signInAccepted = Boolean(server?.adminSignIn && hasIdTokenProvider());

  // ----- the open import -----
  const session = sessionId ? store.sessions.find((s) => s.id === sessionId) ?? null : null;
  const staged = useMemo(() => (sessionId ? store.drafts[sessionId] ?? [] : []), [store.drafts, sessionId]);
  const result = session?.result ?? null;
  const file = sessionId ? store.files[sessionId] ?? null : null;
  const publishedIds = session?.publishedIds ?? [];
  const acknowledgedMissing = session?.acknowledgedMissing ?? [];
  const decisions = session?.duplicateDecisions ?? {};

  useEffect(() => {
    if (!sessionId || !store.loaded) return;
    if (!store.sessions.some((s) => s.id === sessionId)) {
      setSessionId(null);
      writeSelected(null);
      return;
    }
    void importQueue.open(sessionId);
  }, [sessionId, store.loaded, store.sessions.length]);

  const openSession = (id: string) => {
    setSessionId(id);
    writeSelected(id);
    setChecked([]);
    setFilter('all');
    setSearch('');
    setTab('review');
    setSelectedId(null);
    setViewerPage(1);
    void importQueue.open(id).then(() => {
      const first = importQueue.getState().drafts[id]?.[0];
      if (first) {
        setSelectedId(first.id);
        setViewerPage(first.sourcePdfPage ?? 1);
      }
      requestAnimationFrame(() => document.getElementById('import-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  };

  const setStaged = (fn: (prev: Question[]) => Question[]) => sessionId && importQueue.updateDrafts(sessionId, fn);
  const update = (id: string, fn: (q: Question) => Question) => setStaged((prev) => prev.map((q) => (q.id === id ? fn(q) : q)));

  // ----- derived -----
  const report = useMemo(() => {
    if (!result) return null;
    return buildExtractionReport({
      filename: result.filename,
      fileSize: result.report.fileSize,
      totalPages: result.totalPages,
      questions: staged,
      pages: result.report.pages,
      documentIssues: result.documentIssues,
      engineUsed: result.engine,
      documentHash: result.documentHash,
      answerKeyFound: result.report.answerKeyFound,
      imageReadingAvailable: result.report.imageReadingAvailable,
      acknowledgedMissing,
      timestamp: result.report.extractionTimestamp,
    });
  }, [result, staged, acknowledgedMissing]);

  const duplicates = useMemo(() => findDuplicates(existingQuestions, staged), [existingQuestions, staged]);
  // Duplicates whose publishing choice still matters: not rejected and not yet published.
  const duplicateIds = useMemo(
    () => staged.filter((q) => duplicates.has(q.id) && q.reviewStatus !== 'rejected' && !publishedIds.includes(q.id)).map((q) => q.id),
    [staged, duplicates, publishedIds]
  );
  const decisionCounts = countDuplicateDecisions(decisions, duplicateIds);
  const setAllDuplicates = (d: DuplicateDecision) => {
    if (!session || duplicateIds.length === 0) return;
    importQueue.setDuplicateDecisions(session.id, duplicateIds, d);
    setNotice(`All ${duplicateIds.length} duplicate${duplicateIds.length === 1 ? '' : 's'} set to "${DECISION_LABEL[d]}" when publishing. You can still change single questions.`);
  };
  const allTotals = useMemo(() => importTotals(store.sessions), [store.sessions]);
  const importedBefore = useMemo(
    () => (session ? pdfSources.find((s) => (session.fileHash && s.fileHash === session.fileHash) || s.filename.toLowerCase() === session.filename.toLowerCase()) ?? null : null),
    [session, pdfSources]
  );

  const publishable = (q: Question) => q.reviewStatus === 'approved' && isReviewedForExams(q) && !publishedIds.includes(q.id);
  const counts = useMemo(() => {
    const live = staged.filter((q) => q.reviewStatus !== 'rejected');
    return {
      total: live.length,
      approved: live.filter((q) => q.reviewStatus === 'approved').length,
      autoVerified: live.filter((q) => q.reviewStatus === 'pending' && q.contentStatus === 'verified' && !approvalBlocker(q)).length,
      publishable: live.filter(publishable).length,
      selectedPublishable: live.filter((q) => checked.includes(q.id) && publishable(q)).length,
      approvedNoAnswer: live.filter((q) => q.reviewStatus === 'approved' && !isReviewedForExams(q)).length,
      needAi: live.filter((q) => !q.aiSolution && q.options.length >= 2).length,
      unanswered: live.filter((q) => !q.correctAnswer).length,
    };
  }, [staged, publishedIds, checked]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staged.filter((q) => {
      if (onlyThisPage && !(q.sourcePdfPages ?? [q.sourcePdfPage]).includes(viewerPage)) return false;
      if (term && !`${q.originalQuestionNumber} ${q.question} ${q.options.map((o) => o.text).join(' ')} ${q.topic}`.toLowerCase().includes(term)) return false;
      switch (filter) {
        case 'attention':
          return q.reviewStatus === 'pending' && q.contentStatus !== 'verified';
        case 'incomplete':
        case 'needs_review':
        case 'verified':
          return q.reviewStatus !== 'rejected' && q.contentStatus === filter;
        case 'approved':
        case 'rejected':
          return q.reviewStatus === filter;
        case 'unanswered':
          return q.reviewStatus !== 'rejected' && !q.correctAnswer;
        case 'duplicates':
          return duplicates.has(q.id);
        case 'selected':
          return checked.includes(q.id);
        default:
          return true;
      }
    });
  }, [staged, filter, search, onlyThisPage, viewerPage, duplicates, checked]);

  const highlights: ViewerHighlight[] = useMemo(
    () =>
      staged
        .filter((q) => q.reviewStatus !== 'rejected')
        .flatMap((q) =>
          (q.sourceRegions ?? []).map((region, i) => ({
            id: `${q.id}::${i}`,
            region,
            tone: q.id === selectedId ? 'selected' : q.reviewStatus === 'approved' || q.contentStatus === 'verified' ? 'ok' : 'issue',
            label: `Question ${q.originalQuestionNumber}`,
          }))
        ),
    [staged, selectedId]
  );

  // ----- uploads -----
  const startImport = async (files: File[], settings: UploadSettings, allowRepeat = false) => {
    setError(null);
    setNotice(null);
    setRepeat(null);
    const outcome = await importQueue.enqueue(files, { ...settings, autoAnswer: settings.autoAnswer && aiAvailable, allowRepeat });
    const parts: string[] = [];
    if (outcome.queued.length) {
      parts.push(
        `${outcome.queued.length} file${outcome.queued.length === 1 ? '' : 's'} queued. Processing continues in the background while you use other pages; results are saved as drafts.`
      );
      if (!sessionId) openSession(outcome.queued[0]!);
    }
    if (outcome.rejected.length) setError(outcome.rejected.map((r) => `${r.name}: ${r.reason}`).join(' '));
    if (outcome.repeated.length) {
      setRepeat({
        files: files.filter((f) => outcome.repeated.some((r) => r.name === f.name)),
        settings,
        names: outcome.repeated.map((r) => r.name),
      });
    }
    if (parts.length) setNotice(parts.join(' '));
  };

  // ----- review actions -----
  const selectQuestion = (q: Question) => {
    setSelectedId(q.id);
    const first = q.sourceRegions?.[0]?.page ?? q.sourcePdfPage;
    if (first && first !== viewerPage) setViewerPage(first);
  };

  const requestApprove = (q: Question) => {
    const blocker = approvalBlocker(q);
    if (blocker) {
      setError(`Question #${q.originalQuestionNumber}: ${blocker}`);
      setEditing({ question: q, isNew: false });
      return;
    }
    if (issuesToConfirm(q).length > 0) setConfirmApprove(q);
    else update(q.id, (x) => approveQuestion(x));
  };

  const approveAllVerified = () => {
    let n = 0;
    setStaged((prev) =>
      prev.map((q) => {
        if (q.reviewStatus !== 'pending' || q.contentStatus !== 'verified' || approvalBlocker(q)) return q;
        n++;
        return approveQuestion(q);
      })
    );
    setNotice(`Approved ${n} question(s) whose two readings matched with no open issues.`);
  };

  /** Approves the given ids; questions with open findings are approved only after one confirmation. */
  const finishBulkApprove = (what: string, plan: BulkApprovalPlan, includeFindings: boolean) => {
    const ids = includeFindings ? [...plan.ready, ...plan.needConfirm] : plan.ready;
    setStaged((prev) => approveMany(prev, ids));
    const skipped = includeFindings ? 0 : plan.needConfirm.length;
    setNotice(
      `Approved ${ids.length} ${what} question(s).` +
        (skipped ? ` ${skipped} with open findings were left pending.` : '') +
        (plan.blocked.length ? ` ${plan.blocked.length} have text that was not read with certainty: edit them to match the PDF, then approve.` : '')
    );
  };

  const bulkApprove = (ids: string[], what: string) => {
    const plan = planBulkApproval(staged, ids);
    if (plan.ready.length + plan.needConfirm.length === 0) {
      setNotice(plan.blocked.length ? `None of the ${what} questions can be approved yet: ${plan.blocked.length} need their text fixed first.` : `No ${what} questions are waiting for approval.`);
      return;
    }
    if (plan.needConfirm.length) setConfirmBulk({ what, plan });
    else finishBulkApprove(what, plan, false);
  };

  const approveChecked = () => bulkApprove(checked, 'selected');
  const pendingShown = visible.filter((q) => q.reviewStatus === 'pending' && !approvalBlocker(q)).length;
  const approveAllShown = () => bulkApprove(visible.map((q) => q.id), filter === 'all' && !search.trim() && !onlyThisPage ? 'pending' : 'shown');

  const move = (id: string, dir: -1 | 1) =>
    setStaged((prev) => {
      const i = prev.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy; // original question numbers are kept; only the exam order changes
    });

  const solve = (q: Question, mode: 'answer' | 'solution') => {
    if (!sessionId) return;
    importQueue.solveQuestion(sessionId, q.id, mode).catch((e: any) => setError(`AI ${mode === 'solution' ? 'solution' : 'answer'} for #${q.originalQuestionNumber}: ${e?.message || e}`));
  };

  const answerAll = async () => {
    if (!sessionId) return;
    const outcome = await importQueue.answerAll(sessionId);
    setNotice(`AI answers added for ${outcome.done - outcome.failed} question(s)${outcome.failed ? `; ${outcome.failed} failed (see the import log)` : ''}. Question text and choices were not changed.`);
  };

  const addMissing = (n?: number) => {
    if (!result) return;
    const number = n ?? Math.max(0, ...staged.map((q) => q.originalQuestionNumber ?? 0)) + 1;
    const blank = newManualQuestion(number, viewerPage, result.sourcePdfId, result.filename, result.documentHash);
    setEditing({ question: { ...blank, course: session?.program, ...(session && session.subjectId !== 'auto' ? { subjectId: session.subjectId, subjectName: SUBJECT_NAMES[session.subjectId] } : {}) }, isNew: true });
  };

  const saveEditing = (draft: Question) => {
    if (!editing) return;
    if (editing.isNew) {
      const created = saveEdit(editing.question, draft);
      setStaged((prev) => {
        const at = prev.findIndex((q) => (q.originalQuestionNumber ?? 0) > (created.originalQuestionNumber ?? 0));
        const copy = [...prev];
        copy.splice(at < 0 ? copy.length : at, 0, created);
        return copy;
      });
      setSelectedId(created.id);
    } else {
      update(draft.id, (prev) => saveEdit(prev, draft));
    }
    setEditing(null);
  };

  const publish = (which: 'approved' | 'selected') => {
    if (!result || !session) return;
    const ready = staged.filter((q) => publishable(q) && (which === 'approved' || checked.includes(q.id)));
    if (ready.length === 0) {
      setError(
        which === 'selected'
          ? 'None of the selected questions can be published yet. A question needs administrator approval and a verified answer.'
          : 'Nothing is ready to publish. A question needs administrator approval and a verified answer.'
      );
      return;
    }
    const source: PdfSource = {
      id: result.sourcePdfId,
      filename: result.filename,
      originalName: result.filename,
      fileSize: result.report.fileSize ?? session.fileSize,
      pageCount: result.totalPages,
      uploadDate: new Date().toISOString().split('T')[0]!,
      status: 'published',
      questionsCount: ready.length,
      verifiedCount: ready.length,
      needsReviewCount: 0,
      subjectCoverage: [],
      isPublicToReviewees: true,
      allowedModes: ['quiz', 'practice', 'preboard', 'mock'],
      notes: `Imported with the AI PDF importer on ${new Date().toLocaleDateString()}. Every published question was approved by an administrator.`,
      ...(report ? { extractionReport: report } : {}),
      fileHash: result.documentHash,
      course: session.program,
    };
    const toPublish = ready.map((q) => refreshQuestionAssessment({ ...q, isPublished: true, course: q.course ?? session.program }));
    const outcome = onPublishQuestions(toPublish, source, decisions) || { added: toPublish.length, skipped: 0, replaced: 0 };
    const replaced = outcome.replaced ?? 0;
    importQueue.updateSession(
      session.id,
      (s) => ({ publishedIds: [...s.publishedIds, ...ready.map((q) => q.id)] }),
      `Published ${outcome.added} question(s)${replaced ? `, replaced ${replaced} in the bank` : ''}${outcome.skipped ? `, skipped ${outcome.skipped} duplicate(s)` : ''}.`
    );
    void importQueue.flushDrafts(session.id);
    setChecked((c) => c.filter((id) => !ready.some((q) => q.id === id)));
    const held = staged.filter((q) => q.reviewStatus !== 'rejected' && !publishedIds.includes(q.id) && !ready.includes(q)).length;
    onAddAuditLog(
      'Questions Published to Bank',
      `Published ${outcome.added} admin-approved ${session.program} question(s) from "${result.filename}"${replaced ? `; replaced ${replaced} bank question(s)` : ''}${outcome.skipped ? `; skipped ${outcome.skipped} already in the bank` : ''}.`,
      'Published'
    );
    setNotice(
      `Published ${outcome.added} question(s) to the Question Bank${replaced ? ` and replaced ${replaced}` : ''}.${outcome.skipped ? ` ${outcome.skipped} duplicate(s) were skipped.` : ''}${
        held ? ` ${held} question(s) are still waiting for approval or an answer.` : ''
      } Published questions are available to ${session.program} reviewees in the exam modules allowed for this question set.`
    );
  };

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ report, questions: staged }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexora_${result.filename.replace(/\W+/g, '_')}_extraction.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const scrollToCard = (id: string) => {
    const q = staged.find((x) => x.id === id.split('::')[0]);
    if (!q) return;
    setSelectedId(q.id);
    setMobilePanel('questions');
    requestAnimationFrame(() => document.getElementById(`staged-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const toggleChecked = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const answering = session?.status === 'answering';

  // ----- render -----
  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <header className="flex flex-col gap-2 border-b border-slate-800 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <FileUp className="w-8 h-8 text-indigo-400 shrink-0" />
          AI PDF Question Importer
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-4xl">
          Questions and choices are taken from the PDF exactly as printed and checked against an independent reading of each page image. AI then works out answers and
          step-by-step solutions, flagging anything it can't determine. Everything is saved as drafts; nothing reaches reviewees until you approve and publish it.
        </p>
      </header>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {(store.loadError || store.saveError) && (
        <div role="alert" className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-800/70 text-amber-100 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-300 shrink-0" />
          <span className="flex-1">{store.loadError ?? store.saveError}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/70 text-emerald-200 text-xs flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {repeat && (
        <div role="alert" className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-800/60 text-amber-100 text-xs flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="flex-1">
            <strong>Already imported:</strong> {repeat.names.join(', ')}. The same file is in your imports below, so it was not processed again.
          </span>
          <button onClick={() => void startImport(repeat.files, repeat.settings, true)} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold">
            Import again anyway
          </button>
          <button onClick={() => setRepeat(null)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200">
            Dismiss
          </button>
        </div>
      )}

      <ImportDashboard totals={allTotals} loading={!store.loaded} />

      {server && !server.available && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-100 text-xs space-y-1">
          <p className="font-bold">The PDF importer can't run on this deployment.</p>
          <p>The extraction service (/api) did not answer. Saved imports can still be reviewed and published.</p>
        </div>
      )}

      <ImportUploader server={server} tokenRequired={tokenRequired} signInAccepted={signInAccepted} token={token} onTokenChange={setToken} onStart={(files, settings) => startImport(files, settings)} />

      <ImportQueueList
        sessions={store.sessions}
        progress={store.progress}
        selectedId={sessionId}
        onOpen={openSession}
        onRetry={(id) => void importQueue.retry(id)}
        onCancel={(id) => importQueue.cancel(id)}
        onDelete={setConfirmDelete}
      />

      {/* ---------- Workspace ---------- */}
      {session && result && report && (
        <section id="import-workspace" className="bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-5 space-y-4 shadow-2xl scroll-mt-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-white break-all">{result.filename}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase border ${REPORT_STYLE[report.overallStatus]}`}>{REPORT_LABEL[report.overallStatus]}</span>
                <span className="px-2 py-0.5 rounded border border-slate-700 text-[11px] text-slate-200 font-semibold">{session.program}</span>
                <span className="text-[11px] text-slate-400">{session.subjectId === 'auto' ? 'subject per question' : SUBJECT_NAMES[session.subjectId]}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {result.totalPages} page(s) · {counts.total} question(s) · {report.totalChoicesDetected} choices · {counts.approved} approved · {report.questionsRequiringVerification} need review ·{' '}
                {counts.unanswered} without an answer{duplicates.size ? ` · ${duplicates.size} duplicate(s)` : ''}
              </p>
              {answering && session.answering && (
                <p className="text-xs text-indigo-300 mt-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Generating answers and solutions: {session.answering.done}/{session.answering.total}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
                {(
                  [
                    ['review', 'Side-by-side review', Split],
                    ['report', 'Extraction report', ListChecks],
                    ['preview', 'Exam preview', Eye],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ${tab === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                    <span className="sm:hidden">{label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setConfirmReextract(true)}
                disabled={session.status === 'extracting' || session.status === 'queued'}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
                title="Run the extraction again on the same file"
              >
                <RotateCcw className="w-4 h-4" /> Retry extraction
              </button>
              <button onClick={exportJson} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700">
                <Download className="w-4 h-4" /> JSON
              </button>
              <button
                onClick={() => publish('selected')}
                disabled={counts.selectedPublishable === 0}
                className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-2"
                title="Publishes the ticked questions that are approved and have a verified answer"
              >
                <CheckCircle2 className="w-4 h-4" /> Publish {counts.selectedPublishable} selected
              </button>
              <button
                onClick={() => publish('approved')}
                disabled={counts.publishable === 0}
                title={counts.approvedNoAnswer ? `${counts.approvedNoAnswer} approved question(s) still need an answer.` : undefined}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Publish all {counts.publishable} approved
              </button>
            </div>
          </div>

          {importedBefore && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs">
              <strong>This document was published before</strong> ({importedBefore.filename}, {importedBefore.uploadDate}). Questions already in the bank are marked, and are skipped when you
              publish unless you choose otherwise on the question.
            </div>
          )}
          {!file && session.kind === 'pdf' && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs">
              The original PDF isn't stored in this browser, so the page view shows the extracted text. Questions, answers and review changes are saved in Firestore as usual.
            </div>
          )}

          {tab === 'report' && (
            <ExtractionReportPanel
              report={report}
              onAddMissing={(n) => addMissing(n)}
              onAcknowledgeMissing={(n) => importQueue.updateSession(session.id, (s) => ({ acknowledgedMissing: [...s.acknowledgedMissing, n] }))}
              onGoToPage={(p) => {
                setViewerPage(p);
                setTab('review');
                setMobilePanel('pdf');
              }}
            />
          )}

          {tab === 'preview' && <ExamPreview questions={staged} />}

          {tab === 'review' && (
            <>
              <div className="lg:hidden inline-flex w-full rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
                {(['pdf', 'questions'] as const).map((p) => (
                  <button key={p} onClick={() => setMobilePanel(p)} className={`flex-1 px-3 py-2 rounded-lg font-semibold ${mobilePanel === p ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                    {p === 'pdf' ? `Original PDF (p.${viewerPage})` : `Extracted questions (${visible.length})`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div
                  className={`${mobilePanel === 'pdf' ? 'flex' : 'hidden'} lg:flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden h-[75vh] lg:h-[calc(100vh-180px)] lg:sticky lg:top-4`}
                >
                  <PdfPageViewer
                    file={file}
                    totalPages={result.totalPages}
                    page={viewerPage}
                    onPageChange={setViewerPage}
                    highlights={highlights}
                    onHighlightClick={scrollToCard}
                    pageTexts={result.pageTexts}
                  />
                </div>

                <div className={`${mobilePanel === 'questions' ? 'flex' : 'hidden'} lg:flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden lg:h-[calc(100vh-180px)]`}>
                  <div className="p-2.5 bg-slate-900 border-b border-slate-800 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative flex-1 min-w-[10rem]">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text, number or topic" className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white" />
                      </div>
                      <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white" aria-label="Filter">
                        <option value="all">All ({staged.length})</option>
                        <option value="attention">Needs my attention</option>
                        <option value="unanswered">Without an answer ({counts.unanswered})</option>
                        <option value="duplicates">Duplicates ({duplicates.size})</option>
                        <option value="incomplete">{STATUS_STYLE.incomplete.label}</option>
                        <option value="needs_review">{STATUS_STYLE.needs_review.label}</option>
                        <option value="verified">Auto-verified</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="selected">Selected ({checked.length})</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-slate-300">
                        <input type="checkbox" checked={onlyThisPage} onChange={(e) => setOnlyThisPage(e.target.checked)} />
                        Page {viewerPage} only
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={approveAllVerified}
                        disabled={counts.autoVerified === 0}
                        className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold"
                        title="Approves only questions whose two independent readings matched exactly and that have no open issues"
                      >
                        Approve {counts.autoVerified} cross-checked
                      </button>
                      <button
                        onClick={approveAllShown}
                        disabled={pendingShown === 0}
                        className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold flex items-center gap-1"
                        title="Approves every pending question in the list below. Questions with open findings are approved only after you confirm."
                      >
                        <CheckCircle2 className="w-3 h-3" /> Approve all {pendingShown} shown
                      </button>
                      <button
                        onClick={() => setChecked(visible.filter((q) => q.reviewStatus !== 'rejected').map((q) => q.id))}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                        title="Ticks every question in the list below"
                      >
                        Select all
                      </button>
                      {checked.length > 0 && (
                        <>
                          <button onClick={approveChecked} className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-semibold">
                            Approve {checked.length} selected
                          </button>
                          <button onClick={() => setChecked([])} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                            Clear selection
                          </button>
                        </>
                      )}
                      {aiAvailable && (
                        <button
                          onClick={() => void answerAll()}
                          disabled={answering || counts.needAi === 0}
                          className="px-2.5 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white font-semibold flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          {answering && session.answering ? `AI solving ${session.answering.done}/${session.answering.total}…` : `Generate answers for ${counts.needAi}`}
                        </button>
                      )}
                      <button onClick={() => addMissing()} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add missing item
                      </button>
                    </div>
                    {duplicateIds.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-fuchsia-900/60 bg-fuchsia-950/20 px-2.5 py-2 text-[11px] text-fuchsia-100">
                        <span className="flex-1 min-w-[12rem]">
                          {duplicateIds.length} question{duplicateIds.length === 1 ? ' is' : 's are'} already in the Question Bank.{' '}
                          <span className="text-fuchsia-300/80">
                            Now: {decisionCounts.skip} skip, {decisionCounts.replace} replace, {decisionCounts.keep} keep both.
                          </span>
                        </span>
                        <label className="flex items-center gap-1.5">
                          Set all to:
                          <select
                            value=""
                            onChange={(e) => e.target.value && setAllDuplicates(e.target.value as DuplicateDecision)}
                            aria-label="Set the publishing choice for all duplicates"
                            className="px-2 py-1 rounded bg-slate-950 border border-fuchsia-800/60 text-white"
                          >
                            <option value="" disabled>
                              Choose…
                            </option>
                            <option value="skip">{DECISION_LABEL.skip}</option>
                            <option value="replace">{DECISION_LABEL.replace}</option>
                            <option value="keep">{DECISION_LABEL.keep}</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 space-y-3">
                    {visible.length === 0 && (
                      <div className="p-8 text-center text-slate-400 text-sm">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        {staged.length === 0 ? 'No questions were extracted. See the extraction report for the reason.' : 'No questions match these filters.'}
                      </div>
                    )}
                    {visible.map((q) => (
                      <div key={q.id} id={`staged-${q.id}`}>
                        {publishedIds.includes(q.id) && <div className="text-[10px] font-bold uppercase text-emerald-400 mb-1">Published to the Question Bank</div>}
                        <QuestionReviewCard
                          question={q}
                          index={staged.indexOf(q)}
                          total={staged.length}
                          selected={q.id === selectedId}
                          duplicate={duplicates.get(q.id)}
                          duplicateDecision={decisions[q.id]}
                          onDuplicateDecision={(d) => importQueue.setDuplicateDecision(session.id, q.id, d)}
                          duplicateCount={duplicateIds.length}
                          onDuplicateDecisionAll={setAllDuplicates}
                          checked={checked.includes(q.id)}
                          onToggleChecked={() => toggleChecked(q.id)}
                          aiBusy={store.aiBusy.includes(q.id)}
                          aiAvailable={aiAvailable}
                          onSelect={() => selectQuestion(q)}
                          onApprove={() => requestApprove(q)}
                          onUnapprove={() => update(q.id, reopenQuestion)}
                          onReject={() => update(q.id, (x) => rejectQuestion(x))}
                          onEdit={() => setEditing({ question: q, isNew: false })}
                          onMove={(d) => move(q.id, d)}
                          onRestore={() =>
                            update(q.id, (x) => saveEdit(x, { ...x, question: x.originalQuestionText ?? x.question, options: (x.originalOptions ?? x.options).map((o) => ({ ...o })) }))
                          }
                          onSetAnswer={(key) => update(q.id, (x) => setAnswer(x, key))}
                          onAskAi={() => solve(q, 'answer')}
                          onRegenerateSolution={() => solve(q, 'solution')}
                          onShowSolution={() => setSolutionFor(q)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {session && !result && (session.status === 'queued' || session.status === 'extracting') && (
        <p className="text-sm text-slate-400 text-center py-6">"{session.filename}" is being extracted. Its questions appear here when it finishes; you can leave this page meanwhile.</p>
      )}

      {editing && (
        <QuestionEditor question={editing.question} title={editing.isNew ? 'Add a question missing from the extraction' : undefined} onCancel={() => setEditing(null)} onSave={saveEditing} />
      )}

      {confirmApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold text-white">Approve question #{confirmApprove.originalQuestionNumber}?</h3>
            <p className="text-slate-300">These findings are still open. Approve only if you compared the question with the PDF and it matches exactly:</p>
            <ul className="list-disc pl-5 space-y-1 text-amber-200 max-h-60 overflow-y-auto">
              {issuesToConfirm(confirmApprove).map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmApprove(null)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200">
                Cancel
              </button>
              <button
                onClick={() => {
                  update(confirmApprove.id, (x) => approveQuestion(x));
                  setConfirmApprove(null);
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
              >
                It matches the PDF — approve
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 text-xs">
            <h3 className="text-base font-bold text-white">
              Approve {confirmBulk.plan.ready.length + confirmBulk.plan.needConfirm.length} {confirmBulk.what} question(s)?
            </h3>
            <p className="text-slate-300">
              {confirmBulk.plan.ready.length} have no open findings. {confirmBulk.plan.needConfirm.length} still have open findings
              {confirmBulk.plan.needConfirm.length <= 12 &&
                ` (#${staged
                  .filter((q) => confirmBulk.plan.needConfirm.includes(q.id))
                  .map((q) => q.originalQuestionNumber)
                  .join(', #')})`}
              . Approve those only if you compared them with the PDF and they match exactly.
            </p>
            {confirmBulk.plan.blocked.length > 0 && (
              <p className="text-amber-200">
                {confirmBulk.plan.blocked.length} more have text that was not read with certainty and will stay pending until you edit them.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button onClick={() => setConfirmBulk(null)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200">
                Cancel
              </button>
              {confirmBulk.plan.ready.length > 0 && (
                <button
                  onClick={() => {
                    finishBulkApprove(confirmBulk.what, confirmBulk.plan, false);
                    setConfirmBulk(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold"
                >
                  Approve only the {confirmBulk.plan.ready.length} without findings
                </button>
              )}
              <button
                onClick={() => {
                  finishBulkApprove(confirmBulk.what, confirmBulk.plan, true);
                  setConfirmBulk(null);
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
              >
                They match the PDF — approve all {confirmBulk.plan.ready.length + confirmBulk.plan.needConfirm.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReextract && session && (
        <ConfirmDialog
          title="Retry extraction?"
          body={`"${session.filename}" is extracted again from the original file. Its current drafts and your review changes for it are replaced; questions already published stay in the Question Bank.`}
          confirmLabel="Extract again"
          onCancel={() => setConfirmReextract(false)}
          onConfirm={() => {
            setConfirmReextract(false);
            void importQueue.retry(session.id, { reextract: true });
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this import?"
          body={`"${confirmDelete.filename}" and its ${confirmDelete.counts.extracted} draft question(s) are deleted. Questions already published to the Question Bank are not affected.`}
          confirmLabel="Delete import"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            if (target.id === sessionId) {
              setSessionId(null);
              writeSelected(null);
            }
            importQueue
              .remove(target.id)
              .then(() => onAddAuditLog('PDF Import Deleted', `Deleted the import of "${target.filename}" and its unpublished drafts.`))
              .catch(() => setError('The import could not be deleted. Check your connection and try again.'));
          }}
        />
      )}

      {solutionFor && <SolutionDialog question={staged.find((q) => q.id === solutionFor.id) ?? solutionFor} onClose={() => setSolutionFor(null)} />}
    </div>
  );
};

const ConfirmDialog: React.FC<{ title: string; body: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }> = ({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 text-sm">
      <h3 className="text-base font-bold text-white">{title}</h3>
      <p className="text-slate-300 text-xs leading-relaxed">{body}</p>
      <div className="flex justify-end gap-2 pt-2 text-xs">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200">
          Cancel
        </button>
        <button onClick={onConfirm} className={`px-4 py-2 rounded-lg text-white font-bold ${danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

const SECTION_STYLE: Record<string, string> = {
  Given: 'text-sky-300',
  Find: 'text-amber-300',
  Formula: 'text-indigo-300',
  Solution: 'text-slate-200',
  'Final Answer': 'text-emerald-300',
  Explanation: 'text-slate-300',
};

export const SolutionDialog: React.FC<{ question: Question; onClose: () => void }> = ({ question: q, onClose }) => {
  const sections = parseSolutionSections(q.stepByStepSolution || q.aiSolution?.stepByStepSolution || '');
  const hasExplanationSection = sections.some((s) => s.heading === 'Explanation');
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 p-3 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4 text-xs my-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Solution — question #{q.originalQuestionNumber}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-slate-300">
          Correct answer:{' '}
          {q.correctAnswer ? (
            <strong className="text-emerald-300">
              {q.correctAnswer}. {q.options.find((o) => o.key === q.correctAnswer)?.text}
            </strong>
          ) : (
            <strong className="text-amber-300">Needs verification</strong>
          )}
        </p>
        {q.sourceSolutionText && (
          <section className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <h4 className="font-semibold text-slate-200 mb-1">Printed in the PDF</h4>
            <p className="text-slate-300 whitespace-pre-wrap">{q.sourceSolutionText}</p>
          </section>
        )}
        {q.aiSolution && (
          <p className="text-slate-400">
            AI-generated ({q.aiSolution.model}) · AI answer {q.aiSolution.suggestedAnswer ?? 'not determined'} · {q.aiSolution.confidence} confidence. Generated separately from the question; it did
            not change the question text or choices. Edit the question to correct any of it.
          </p>
        )}
        {sections.length > 0 ? (
          <div className="space-y-3">
            {sections.map((s, i) => (
              <section key={i} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                {s.heading && <h4 className={`font-bold uppercase tracking-wide text-[11px] mb-1 ${SECTION_STYLE[s.heading]}`}>{s.heading}</h4>}
                <p className="whitespace-pre-wrap font-mono text-slate-200 leading-relaxed">{s.body}</p>
              </section>
            ))}
          </div>
        ) : null}
        {!hasExplanationSection && q.explanation && !q.sourceSolutionText && <p className="text-slate-300 whitespace-pre-wrap">{q.explanation}</p>}
      </div>
    </div>
  );
};
