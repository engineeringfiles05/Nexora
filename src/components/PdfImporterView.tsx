/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileCheck,
  FileText,
  FileUp,
  KeyRound,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Split,
  UploadCloud,
  X,
} from 'lucide-react';
import type { PdfSource, Question } from '../types/index.ts';
import { IMPORT_PRESETS } from '../data/importPresets.ts';
import { findBankDuplicates, isReviewedForExams } from '../utils/bank.ts';
import { classifyQuestionnaireFile, formatFileSize } from '../utils/importFile.ts';
import { buildExtractionReport, refreshQuestionAssessment } from '../utils/questionExtractor.ts';
import {
  applyAiSolution,
  approvalBlocker,
  approveQuestion,
  issuesToConfirm,
  newManualQuestion,
  rejectQuestion,
  reopenQuestion,
  saveEdit,
  setAnswer,
} from '../utils/importReview.ts';
import {
  fileToBase64,
  getServerCapabilities,
  hasIdTokenProvider,
  readSessionToken,
  requestAiSolution,
  runExtractionJob,
  runExtractionStream,
  uploadTooLarge,
  BACKEND_UNAVAILABLE,
  type ServerCapabilities,
  sha256Hex,
  writeSessionToken,
  type ExtractionResult,
  type JobProgress,
} from '../utils/importerClient.ts';
import { PdfPageViewer, type ViewerHighlight } from './importer/PdfPageViewer.tsx';
import { QuestionReviewCard, STATUS_STYLE } from './importer/QuestionReviewCard.tsx';
import { QuestionEditor } from './importer/QuestionEditor.tsx';
import { ExtractionReportPanel } from './importer/ExtractionReportPanel.tsx';
import { ExamPreview } from './importer/ExamPreview.tsx';

interface Props {
  existingQuestions: Question[];
  pdfSources: PdfSource[];
  onPublishQuestions: (newQuestions: Question[], sourcePdf: PdfSource) => { added: number; skipped: number } | void;
  onAddAuditLog: (action: string, details: string, badge?: string) => void;
}

type Filter = 'all' | 'attention' | 'incomplete' | 'needs_review' | 'verified' | 'approved' | 'rejected';

const REPORT_LABEL = { verified: 'Verified', needs_review: 'Needs review', incomplete: 'Incomplete', failed: 'Failed' } as const;
const REPORT_STYLE = {
  verified: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  needs_review: 'bg-amber-950 text-amber-300 border-amber-800/60',
  incomplete: 'bg-rose-950 text-rose-300 border-rose-800/60',
  failed: 'bg-rose-900 text-rose-100 border-rose-600',
} as const;

export const PdfImporterView: React.FC<Props> = ({ existingQuestions, pdfSources, onPublishQuestions, onAddAuditLog }) => {
  // ----- input -----
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [presetId, setPresetId] = useState<string>('custom');
  const [rawText, setRawText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [token, setToken] = useState<string>(() => readSessionToken());
  const [imageReading, setImageReading] = useState<boolean | null>(null);
  const [tokenRequired, setTokenRequired] = useState(true);
  const [signInAccepted, setSignInAccepted] = useState(false);
  const [server, setServer] = useState<ServerCapabilities | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- processing -----
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // ----- staging -----
  const [result, setResult] = useState<Omit<ExtractionResult, 'questions'> | null>(null);
  const [staged, setStaged] = useState<Question[]>([]);
  const [publishedIds, setPublishedIds] = useState<string[]>([]);
  const [acknowledgedMissing, setAcknowledgedMissing] = useState<number[]>([]);
  const [tab, setTab] = useState<'review' | 'report' | 'preview'>('review');
  const [mobilePanel, setMobilePanel] = useState<'pdf' | 'questions'>('questions');
  const [viewerPage, setViewerPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [onlyThisPage, setOnlyThisPage] = useState(false);
  const [editing, setEditing] = useState<{ question: Question; isNew: boolean } | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<Question | null>(null);
  const [solutionFor, setSolutionFor] = useState<Question | null>(null);
  const [aiBusy, setAiBusy] = useState<string[]>([]);
  const [bulkAi, setBulkAi] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    getServerCapabilities().then((c) => {
      setServer(c);
      setImageReading(c.imageReading);
      // Development servers without NEXORA_ADMIN_TOKEN need no token, and a server that verifies
      // the administrator's sign-in needs none either, so the field is hidden.
      setTokenRequired(c.adminTokenRequired && !(c.adminSignIn && hasIdTokenProvider()));
      setSignInAccepted(c.adminSignIn && hasIdTokenProvider());
    });
  }, []);

  useEffect(() => {
    writeSessionToken(token);
  }, [token]);

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

  const bankDuplicates = useMemo(() => findBankDuplicates(existingQuestions, staged), [existingQuestions, staged]);

  const existingSource = useMemo(() => {
    const name = file?.name ?? IMPORT_PRESETS.find((p) => p.id === presetId)?.name;
    return pdfSources.find((s) => (fileHash && s.fileHash === fileHash) || (name && s.filename.toLowerCase() === name.toLowerCase())) ?? null;
  }, [file, fileHash, presetId, pdfSources]);

  const counts = useMemo(() => {
    const live = staged.filter((q) => q.reviewStatus !== 'rejected');
    return {
      total: live.length,
      approved: live.filter((q) => q.reviewStatus === 'approved').length,
      autoVerified: live.filter((q) => q.reviewStatus === 'pending' && q.contentStatus === 'verified').length,
      publishable: live.filter((q) => q.reviewStatus === 'approved' && isReviewedForExams(q) && !publishedIds.includes(q.id)).length,
      approvedNoAnswer: live.filter((q) => q.reviewStatus === 'approved' && !isReviewedForExams(q)).length,
      needAi: live.filter((q) => !q.aiSolution && q.options.length >= 2).length,
    };
  }, [staged, publishedIds]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staged.filter((q) => {
      if (onlyThisPage && !(q.sourcePdfPages ?? [q.sourcePdfPage]).includes(viewerPage)) return false;
      if (term && !`${q.originalQuestionNumber} ${q.question} ${q.options.map((o) => o.text).join(' ')}`.toLowerCase().includes(term)) return false;
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
        default:
          return true;
      }
    });
  }, [staged, filter, search, onlyThisPage, viewerPage]);

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

  // ----- input handlers -----
  const loadFile = async (f: File) => {
    const kind = classifyQuestionnaireFile(f);
    if (!kind) {
      setError(`"${f.name}" is not supported. Choose a PDF or a TXT file.`);
      return;
    }
    if (f.size > 60 * 1024 * 1024) {
      setError(`"${f.name}" is larger than 60 MB. Split it into smaller files.`);
      return;
    }
    setError(null);
    setPresetId('custom');
    setFile(kind === 'pdf' ? f : null);
    setFileHash('');
    if (kind === 'text') {
      const text = await f.text(); // the whole file; nothing is truncated
      setRawText(text);
      setPresetId(`file:${f.name}`);
      setFileHash(await sha256Hex(text).catch(() => ''));
    } else {
      setRawText('');
      setFileHash(await sha256Hex(await f.arrayBuffer()).catch(() => ''));
    }
  };

  const choosePreset = (id: string) => {
    const preset = IMPORT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setFile(null);
    setFileHash('');
    setRawText(preset.text.trim());
    setError(null);
  };

  const inputName = file?.name ?? (presetId.startsWith('file:') ? presetId.slice(5) : IMPORT_PRESETS.find((p) => p.id === presetId)?.name);
  const hasInput = Boolean(file) || Boolean(rawText.trim());

  // ----- extraction -----
  const startExtraction = async () => {
    if (!hasInput) return;
    if (server && !server.available) {
      setError(BACKEND_UNAVAILABLE);
      return;
    }
    const tooLarge = file && server ? uploadTooLarge(file.size, server) : null;
    if (tooLarge) {
      setError(tooLarge);
      return;
    }
    setProcessing(true);
    setError(null);
    setNotice(null);
    setProgress({ stage: 'Uploading the document', percent: 1 });
    cancelRef.current = { cancelled: false };
    try {
      const filename = inputName || 'Uploaded_Questionnaire.pdf';
      const body = file
        ? { base64Pdf: await fileToBase64(file), filename, fileSize: formatFileSize(file.size) }
        : { rawText, filename, fileSize: formatFileSize(new Blob([rawText]).size) };
      // Streaming works everywhere, including serverless hosting; jobs only on older servers.
      const data =
        server?.streamingExtraction || !server?.extractionJobs
          ? await runExtractionStream(body, token, setProgress, cancelRef.current)
          : await runExtractionJob(body, token, setProgress, cancelRef.current);
      const { questions, ...meta } = data;
      setResult(meta);
      setStaged(questions);
      setPublishedIds([]);
      setAcknowledgedMissing([]);
      setSelectedId(questions[0]?.id ?? null);
      setViewerPage(questions[0]?.sourcePdfPage ?? 1);
      setTab(questions.length ? 'review' : 'report');
      setFilter('all');
      onAddAuditLog(
        'PDF Extraction Completed',
        `Extracted ${questions.length} question(s) from "${filename}" (${data.totalPages} page(s)). Status: ${REPORT_LABEL[data.report.overallStatus]}. ${data.report.questionsRequiringVerification} need review.`,
        REPORT_LABEL[data.report.overallStatus]
      );
    } catch (e: any) {
      setError(e?.message || 'The document could not be processed.');
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  // ----- review actions -----
  const update = (id: string, fn: (q: Question) => Question) => setStaged((prev) => prev.map((q) => (q.id === id ? fn(q) : q)));

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

  const move = (id: string, dir: -1 | 1) =>
    setStaged((prev) => {
      const i = prev.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy; // original question numbers are kept; only the exam order changes
    });

  const askAi = async (q: Question) => {
    setAiBusy((b) => [...b, q.id]);
    try {
      const solution = await requestAiSolution(q, token);
      update(q.id, (x) => applyAiSolution(x, solution));
    } catch (e: any) {
      setError(`AI solution for #${q.originalQuestionNumber}: ${e?.message || e}`);
      throw e;
    } finally {
      setAiBusy((b) => b.filter((id) => id !== q.id));
    }
  };

  const askAiForAll = async () => {
    const queue = staged.filter((q) => q.reviewStatus !== 'rejected' && !q.aiSolution && q.options.length >= 2);
    setBulkAi({ done: 0, total: queue.length });
    let failures = 0;
    let index = 0;
    const worker = async () => {
      while (index < queue.length) {
        const q = queue[index++];
        try {
          await askAi(q);
        } catch {
          failures++;
        }
        setBulkAi((s) => (s ? { ...s, done: s.done + 1 } : s));
      }
    };
    await Promise.all([worker(), worker()]);
    setBulkAi(null);
    setNotice(`AI solutions added for ${queue.length - failures} question(s)${failures ? `; ${failures} failed` : ''}. Question text and choices were not changed.`);
  };

  const addMissing = (n?: number) => {
    if (!result) return;
    const number = n ?? Math.max(0, ...staged.map((q) => q.originalQuestionNumber ?? 0)) + 1;
    setEditing({ question: newManualQuestion(number, viewerPage, result.sourcePdfId, result.filename, result.documentHash), isNew: true });
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

  const publish = () => {
    if (!result) return;
    const ready = staged.filter((q) => q.reviewStatus === 'approved' && isReviewedForExams(q) && !publishedIds.includes(q.id));
    if (ready.length === 0) {
      setError('Nothing is ready to publish. A question needs administrator approval and a verified answer.');
      return;
    }
    const source: PdfSource = {
      id: result.sourcePdfId,
      filename: result.filename,
      originalName: result.filename,
      fileSize: result.report.fileSize ?? (file ? formatFileSize(file.size) : 'Unknown'),
      pageCount: result.totalPages,
      uploadDate: new Date().toISOString().split('T')[0],
      status: 'published',
      questionsCount: ready.length,
      verifiedCount: ready.length,
      needsReviewCount: 0,
      subjectCoverage: [],
      isPublicToReviewees: true,
      allowedModes: ['quiz', 'practice', 'preboard', 'mock'],
      notes: `Imported with the strict PDF importer on ${new Date().toLocaleDateString()}. Every published question was approved by an administrator.`,
      ...(report ? { extractionReport: report } : {}),
      fileHash: result.documentHash,
    };
    const toPublish = ready.map((q) => refreshQuestionAssessment({ ...q, isPublished: true }));
    const outcome = onPublishQuestions(toPublish, source) || { added: toPublish.length, skipped: 0 };
    setPublishedIds((prev) => [...prev, ...ready.map((q) => q.id)]);
    const held = staged.filter((q) => q.reviewStatus !== 'rejected' && !publishedIds.includes(q.id) && !ready.includes(q)).length;
    onAddAuditLog(
      'Questions Published to Bank',
      `Published ${outcome.added} admin-approved question(s) from "${result.filename}"${outcome.skipped ? `; skipped ${outcome.skipped} already in the bank` : ''}.`,
      'Published'
    );
    setNotice(
      `Published ${outcome.added} question(s) to the Question Bank.${outcome.skipped ? ` ${outcome.skipped} were already in the bank and were skipped.` : ''}${
        held ? ` ${held} question(s) are still waiting for approval or an answer.` : ''
      }`
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

  // ----- render -----
  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <header className="flex flex-col gap-2 border-b border-slate-800 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <FileUp className="w-8 h-8 text-indigo-400 shrink-0" />
          PDF Question Importer
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-4xl">
          Questions and choices are taken from the PDF exactly as printed. Each page is checked against an independent reading of its image when page-image reading is
          available, anything uncertain is flagged, and nothing reaches reviewees until an administrator approves it.
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
      {notice && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/70 text-emerald-200 text-xs flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ---------- Upload ---------- */}
      <section className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 space-y-4 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
              Upload a questionnaire
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Text PDFs, scanned papers, multi-column layouts, equations, diagrams and tables. Up to{' '}
              {server?.maxUploadBytes ? formatFileSize(server.maxUploadBytes) : '60 MB'}
              {server?.timeLimitSeconds ? ` and about ${Math.floor(server.timeLimitSeconds / 60)} minutes of processing per file on this hosting` : ''}.
            </p>
          </div>
          <span
            className={`self-start px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              imageReading ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60' : 'bg-amber-950 text-amber-300 border-amber-800/60'
            }`}
            title={
              imageReading
                ? 'Scanned pages are read from their image, and every text page is cross-checked against its image.'
                : 'Without GEMINI_API_KEY on the server, scanned pages cannot be read and text pages are not cross-checked.'
            }
          >
            {server === null
              ? 'Checking server…'
              : !server.available
                ? 'Extraction service unavailable'
                : imageReading
                  ? 'Page-image reading & cross-check: on'
                  : 'Page-image reading: off (text layer only)'}
          </span>
        </div>

        {server && !server.available && (
          <div role="alert" className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-100 text-xs space-y-1">
            <p className="font-bold">The PDF importer can't run on this deployment.</p>
            <p>{BACKEND_UNAVAILABLE}</p>
            <p className="text-rose-200/80">Nothing you upload here will be processed. The rest of the site keeps working.</p>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) loadFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition ${
            isDragging ? 'border-indigo-400 bg-indigo-950/20' : hasInput ? 'border-emerald-500/60 bg-emerald-950/10' : 'border-slate-700 hover:border-slate-500 bg-slate-950/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            accept=".pdf,.txt,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-col items-center gap-2">
            {hasInput ? <FileCheck className="w-8 h-8 text-emerald-400" /> : <UploadCloud className="w-8 h-8 text-slate-400" />}
            {hasInput ? (
              <>
                <div className="text-sm font-bold text-white break-all">{inputName}</div>
                <div className="text-xs text-slate-400">{file ? formatFileSize(file.size) : 'Text questionnaire'} · click to choose another file</div>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-white">
                  Drop a PDF here, or <span className="text-indigo-400 underline">browse</span>
                </div>
                <div className="text-xs text-slate-400">PDF or TXT</div>
              </>
            )}
          </div>
        </div>

        {existingSource && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-xs">
            <strong>This document was imported before</strong> ({existingSource.filename}, {existingSource.uploadDate}, {existingSource.questionsCount} question(s)). You can extract it
            again: questions already in the bank are detected and skipped when you publish.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Samples:</span>
          {IMPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => choosePreset(p.id)}
              title={p.description}
              className={`px-2.5 py-1 rounded-lg border ${presetId === p.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              {p.name.replace(/\.pdf$/i, '')}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row md:items-end gap-3 pt-1">
          {tokenRequired ? (
            <label className="flex-1 max-w-md text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-semibold mb-1">
                <KeyRound className="w-3.5 h-3.5" /> Admin access token
              </span>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="The NEXORA_ADMIN_TOKEN value set on the server"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
              />
            </label>
          ) : (
            <p className="flex-1 text-xs text-slate-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />{' '}
              {signInAccepted ? 'Signed in as administrator: your sign-in authorizes AI features.' : 'Development server: no admin token needed.'}
            </p>
          )}
          <div className="flex gap-2 md:ml-auto">
            {processing && (
              <button onClick={() => (cancelRef.current.cancelled = true)} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold">
                Cancel
              </button>
            )}
            <button
              onClick={startExtraction}
              disabled={processing || !hasInput || server?.available === false}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-2"
            >
              {processing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {processing ? 'Extracting…' : 'Extract questions'}
            </button>
          </div>
        </div>

        {processing && progress && (
          <div className="p-3.5 bg-slate-950 rounded-2xl border border-indigo-900/50 space-y-2" aria-live="polite">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300 gap-3">
              <span className="text-indigo-300">{progress.stage}</span>
              <span className="font-bold text-white">{progress.percent}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-2 rounded-full transition-all duration-500" style={{ width: `${Math.max(2, progress.percent)}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* ---------- Workspace ---------- */}
      {result && report && (
        <section className="bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-5 space-y-4 shadow-2xl">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-white break-all">{result.filename}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase border ${REPORT_STYLE[report.overallStatus]}`}>
                  {REPORT_LABEL[report.overallStatus]}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {result.totalPages} page(s) · {counts.total} question(s) · {report.totalChoicesDetected} choices · {counts.approved} approved ·{' '}
                {report.questionsRequiringVerification} need review
              </p>
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
              <button onClick={exportJson} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700">
                <Download className="w-4 h-4" /> JSON
              </button>
              <button
                onClick={publish}
                disabled={counts.publishable === 0}
                title={counts.approvedNoAnswer ? `${counts.approvedNoAnswer} approved question(s) still need an answer.` : undefined}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Publish {counts.publishable} approved
              </button>
            </div>
          </div>

          {tab === 'report' && (
            <ExtractionReportPanel
              report={report}
              onAddMissing={(n) => addMissing(n)}
              onAcknowledgeMissing={(n) => setAcknowledgedMissing((a) => [...a, n])}
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
                  <button
                    key={p}
                    onClick={() => setMobilePanel(p)}
                    className={`flex-1 px-3 py-2 rounded-lg font-semibold ${mobilePanel === p ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
                  >
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
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search text or number"
                          className="w-full pl-8 pr-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                        />
                      </div>
                      <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white" aria-label="Filter">
                        <option value="all">All ({staged.length})</option>
                        <option value="attention">Needs my attention</option>
                        <option value="incomplete">{STATUS_STYLE.incomplete.label}</option>
                        <option value="needs_review">{STATUS_STYLE.needs_review.label}</option>
                        <option value="verified">Auto-verified</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
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
                      {imageReading && (
                        <button
                          onClick={askAiForAll}
                          disabled={Boolean(bulkAi) || counts.needAi === 0}
                          className="px-2.5 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white font-semibold flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          {bulkAi ? `AI solving ${bulkAi.done}/${bulkAi.total}…` : `AI answers for ${counts.needAi}`}
                        </button>
                      )}
                      <button onClick={() => addMissing()} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add missing item
                      </button>
                    </div>
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
                          duplicateOf={bankDuplicates.get(q.id)}
                          aiBusy={aiBusy.includes(q.id)}
                          aiAvailable={Boolean(imageReading)}
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
                          onAskAi={() => askAi(q).catch(() => {})}
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

      {editing && (
        <QuestionEditor
          question={editing.question}
          title={editing.isNew ? 'Add a question missing from the extraction' : undefined}
          onCancel={() => setEditing(null)}
          onSave={saveEditing}
        />
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

      {solutionFor && (
        <SolutionDialog question={staged.find((q) => q.id === solutionFor.id) ?? solutionFor} onClose={() => setSolutionFor(null)} />
      )}
    </div>
  );
};

const SolutionDialog: React.FC<{ question: Question; onClose: () => void }> = ({ question: q, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 p-3 overflow-y-auto">
    <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4 text-xs my-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Solution — question #{q.originalQuestionNumber}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      {q.sourceSolutionText && (
        <section className="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <h4 className="font-semibold text-slate-200 mb-1">Printed in the PDF</h4>
          <p className="text-slate-300 whitespace-pre-wrap">{q.sourceSolutionText}</p>
        </section>
      )}
      {q.aiSolution ? (
        <section className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-900/60 space-y-2">
          <h4 className="font-semibold text-indigo-200">
            AI-generated ({q.aiSolution.model}) · answer {q.aiSolution.suggestedAnswer ?? 'not determined'} · {q.aiSolution.confidence} confidence
          </h4>
          <p className="text-slate-400">Generated separately from the question. It did not change the question text or choices.</p>
          {q.aiSolution.stepByStepSolution && <pre className="whitespace-pre-wrap font-mono text-slate-200">{q.aiSolution.stepByStepSolution}</pre>}
          {q.aiSolution.explanation && <p className="text-slate-300">{q.aiSolution.explanation}</p>}
          {q.aiSolution.finalAnswerWithUnit && <p className="font-mono text-emerald-300">Result: {q.aiSolution.finalAnswerWithUnit}</p>}
        </section>
      ) : (
        !q.sourceSolutionText && <p className="text-slate-300 whitespace-pre-wrap">{q.explanation}</p>
      )}
    </div>
  </div>
);
