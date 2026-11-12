/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Eye, FileText, KeyRound, Loader2, RefreshCw, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import type { Course, SubjectId } from '../../types/index.ts';
import { EXAM_PROGRAMS, programById } from '../../data/programs.ts';
import { IMPORT_PRESETS } from '../../data/importPresets.ts';
import { classifyQuestionnaireFile, formatFileSize } from '../../utils/importFile.ts';
import { countPdfPages } from '../../utils/pdfInfo.ts';
import type { ServerCapabilities } from '../../utils/importerClient.ts';
import { PdfPageViewer } from './PdfPageViewer.tsx';

export interface PendingFile {
  key: string;
  file: File;
  pages: number | null | 'counting';
}

export interface UploadSettings {
  program: Course;
  subjectId: SubjectId | 'auto';
  autoAnswer: boolean;
}

interface Props {
  server: ServerCapabilities | null;
  tokenRequired: boolean;
  signInAccepted: boolean;
  token: string;
  onTokenChange: (token: string) => void;
  onStart: (files: File[], settings: UploadSettings) => Promise<void>;
}

export const ImportUploader: React.FC<Props> = ({ server, tokenRequired, signInAccepted, token, onTokenChange, onStart }) => {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [settings, setSettings] = useState<UploadSettings>({ program: 'REE', subjectId: 'auto', autoAnswer: true });
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<PendingFile | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const aiAvailable = Boolean(server?.imageReading);
  const program = programById(settings.program);

  const add = (files: File[], replaceKey?: string) => {
    const accepted: PendingFile[] = [];
    const refused: string[] = [];
    for (const file of files) {
      if (!classifyQuestionnaireFile(file)) {
        refused.push(`${file.name} (not a PDF or TXT)`);
        continue;
      }
      if (file.size > 60 * 1024 * 1024) {
        refused.push(`${file.name} (over 60 MB)`);
        continue;
      }
      const isPdf = classifyQuestionnaireFile(file) === 'pdf';
      const entry: PendingFile = { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`, file, pages: isPdf ? 'counting' : null };
      accepted.push(entry);
      if (isPdf) {
        countPdfPages(file).then((pages) => setPending((list) => list.map((p) => (p.key === entry.key ? { ...p, pages } : p))));
      }
    }
    setProblem(refused.length ? `Not added: ${refused.join(', ')}.` : null);
    setPending((list) => {
      if (replaceKey && accepted[0]) return list.map((p) => (p.key === replaceKey ? accepted[0]! : p));
      const names = new Set(list.map((p) => `${p.file.name}-${p.file.size}`));
      return [...list, ...accepted.filter((p) => !names.has(`${p.file.name}-${p.file.size}`))];
    });
  };

  const addSample = (id: string) => {
    const preset = IMPORT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    add([new File([preset.text.trim()], preset.name.replace(/\.pdf$/i, '.txt'), { type: 'text/plain' })]);
  };

  const start = async () => {
    if (!pending.length) return;
    setStarting(true);
    try {
      await onStart(
        pending.map((p) => p.file),
        settings
      );
      setPending([]);
    } finally {
      setStarting(false);
    }
  };

  const unavailable = server !== null && !server.available;
  const totalPages = pending.reduce((n, p) => n + (typeof p.pages === 'number' ? p.pages : 0), 0);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 space-y-4 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-indigo-400" />
            Upload questionnaires
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            One or more PDFs: text PDFs, scanned papers, multi-column layouts, equations, diagrams and tables. Up to{' '}
            {server?.maxUploadBytes ? formatFileSize(server.maxUploadBytes) : '60 MB'} each
            {server?.timeLimitSeconds ? `, about ${Math.floor(server.timeLimitSeconds / 60)} minutes of processing per file on this hosting` : ''}.
          </p>
        </div>
        <span
          className={`self-start px-2.5 py-1 rounded-full text-[11px] font-semibold border ${aiAvailable ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60' : 'bg-amber-950 text-amber-300 border-amber-800/60'}`}
          title={aiAvailable ? 'Scanned pages are read from their image, every text page is cross-checked, and AI answers are available.' : 'Without GEMINI_API_KEY on the server, scanned pages cannot be read and AI answers are off.'}
        >
          {server === null ? 'Checking server…' : unavailable ? 'Extraction service unavailable' : aiAvailable ? 'AI reading, cross-check & answers: on' : 'AI: off (text layer only)'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <label className="block">
          <span className="block font-semibold text-slate-300 mb-1">Examination program</span>
          <select
            value={settings.program}
            onChange={(e) => setSettings((s) => ({ ...s, program: e.target.value as Course, subjectId: 'auto' }))}
            className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white"
          >
            {EXAM_PROGRAMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block font-semibold text-slate-300 mb-1">Subject category</span>
          <select
            value={settings.subjectId}
            onChange={(e) => setSettings((s) => ({ ...s, subjectId: e.target.value as SubjectId | 'auto' }))}
            className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white"
          >
            <option value="auto">Detect per question</option>
            {program.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </label>
        <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${aiAvailable ? 'border-slate-700 bg-slate-950/60 cursor-pointer' : 'border-slate-800 bg-slate-950/30 opacity-60'}`}>
          <input
            type="checkbox"
            className="mt-0.5 accent-indigo-500"
            checked={settings.autoAnswer && aiAvailable}
            disabled={!aiAvailable}
            onChange={(e) => setSettings((s) => ({ ...s, autoAnswer: e.target.checked }))}
          />
          <span>
            <span className="block font-semibold text-white">Generate answers & solutions</span>
            <span className="block text-[11px] text-slate-400">After extraction, AI works out each answer with a step-by-step solution. Uncertain ones are marked Needs verification.</span>
          </span>
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files ?? []));
        }}
        onClick={() => {
          replaceTarget.current = null;
          input.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition ${dragging ? 'border-indigo-400 bg-indigo-950/30 scale-[1.01]' : 'border-slate-700 hover:border-slate-500 bg-slate-950/40'}`}
      >
        <input
          type="file"
          ref={input}
          multiple
          accept=".pdf,.txt,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) add(replaceTarget.current ? files.slice(0, 1) : files, replaceTarget.current ?? undefined);
            replaceTarget.current = null;
            e.target.value = '';
          }}
        />
        <UploadCloud className={`w-9 h-9 mx-auto ${dragging ? 'text-indigo-300 animate-bounce' : 'text-slate-400'}`} />
        <div className="mt-2 text-sm font-bold text-white">
          Drop PDF files here, or <span className="text-indigo-400 underline">browse</span>
        </div>
        <div className="text-xs text-slate-400">You can add several at once. PDF or TXT.</div>
      </div>

      {problem && <p className="text-xs text-amber-300">{problem}</p>}

      {pending.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-950/50">
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-3.5 py-2.5 text-xs">
              <FileText className="w-4 h-4 text-indigo-300 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-white truncate">{p.file.name}</span>
                <span className="block text-slate-400">
                  {formatFileSize(p.file.size)} ·{' '}
                  {p.pages === 'counting' ? 'counting pages…' : p.pages === null ? (classifyQuestionnaireFile(p.file) === 'text' ? 'text file' : 'pages unknown') : `${p.pages} page${p.pages === 1 ? '' : 's'}`} · ready to import
                </span>
              </span>
              {classifyQuestionnaireFile(p.file) === 'pdf' && (
                <button
                  onClick={() => {
                    setPreview(p);
                    setPreviewPage(1);
                  }}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                  title="Preview"
                  aria-label={`Preview ${p.file.name}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  replaceTarget.current = p.key;
                  input.current?.click();
                }}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Replace with another file"
                aria-label={`Replace ${p.file.name}`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))} className="p-2 rounded-lg bg-slate-800 hover:bg-rose-700 text-slate-200" title="Remove" aria-label={`Remove ${p.file.name}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">Try a sample:</span>
        {IMPORT_PRESETS.map((p) => (
          <button key={p.id} onClick={() => addSample(p.id)} title={p.description} className="px-2.5 py-1 rounded-lg border bg-slate-800 border-slate-700 text-slate-300 hover:text-white">
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
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder="The NEXORA_ADMIN_TOKEN value set on the server"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
            />
          </label>
        ) : (
          <p className="flex-1 text-xs text-slate-400 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" /> {signInAccepted ? 'Signed in as administrator: your sign-in authorizes AI features.' : 'Development server: no admin token needed.'}
          </p>
        )}
        <button
          onClick={start}
          disabled={!pending.length || starting || unavailable}
          className="md:ml-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {pending.length ? `Import ${pending.length} file${pending.length === 1 ? '' : 's'}${totalPages ? ` (${totalPages} pages)` : ''}` : 'Import'}
        </button>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={`Preview of ${preview.file.name}`}>
          <div className="w-full max-w-3xl h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-bold text-white truncate">{preview.file.name}</span>
              <button onClick={() => setPreview(null)} className="p-1.5 text-slate-400 hover:text-white" aria-label="Close preview">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <PdfPageViewer
                file={preview.file}
                totalPages={typeof preview.pages === 'number' ? preview.pages : 1}
                page={previewPage}
                onPageChange={setPreviewPage}
                highlights={[]}
                onHighlightClick={() => {}}
                pageTexts={[]}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
