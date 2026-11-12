/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, RotateCcw, ScrollText, Sparkles, Square, Trash2 } from 'lucide-react';
import type { JobProgress } from '../../utils/importerClient.ts';
import { IMPORT_STATUS_LABELS, type ImportSession } from '../../utils/importSessions.ts';
import { SUBJECT_NAMES } from '../../utils/questionExtractor.ts';

interface Props {
  sessions: ImportSession[];
  progress: Record<string, JobProgress | undefined>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (session: ImportSession) => void;
}

const STATUS_STYLE: Record<ImportSession['status'], string> = {
  queued: 'bg-slate-800 text-slate-300 border-slate-700',
  extracting: 'bg-indigo-950 text-indigo-200 border-indigo-800/60',
  answering: 'bg-indigo-950 text-indigo-200 border-indigo-800/60',
  ready: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  error: 'bg-rose-950 text-rose-200 border-rose-800/60',
  interrupted: 'bg-amber-950 text-amber-200 border-amber-800/60',
};

export const ImportQueueList: React.FC<Props> = ({ sessions, progress, selectedId, onOpen, onRetry, onCancel, onDelete }) => {
  const [logsFor, setLogsFor] = useState<string | null>(null);
  if (!sessions.length) return null;
  return (
    <section aria-label="Imported files" className="bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-5 space-y-3">
      <h2 className="text-base font-bold text-white flex items-center gap-2 px-1">
        <FileText className="w-5 h-5 text-indigo-400" /> Imports
      </h2>
      <ul className="space-y-2">
        {sessions.map((s) => {
          const p = progress[s.id];
          const running = s.status === 'extracting' || s.status === 'answering' || s.status === 'queued';
          const percent =
            s.status === 'extracting' ? Math.max(2, p?.percent ?? 2) : s.status === 'answering' && s.answering?.total ? Math.round((s.answering.done / s.answering.total) * 100) : s.status === 'ready' ? 100 : 0;
          const selected = s.id === selectedId;
          return (
            <li key={s.id} className={`rounded-2xl border p-3.5 transition ${selected ? 'border-indigo-500/70 bg-indigo-950/20' : 'border-slate-800 bg-slate-950/50'}`}>
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <button onClick={() => onOpen(s.id)} className="min-w-0 flex-1 text-left" disabled={!s.draftOrder.length && s.status !== 'ready'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white truncate max-w-full">{s.filename}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase flex items-center gap-1 ${STATUS_STYLE[s.status]}`}>
                      {running ? <Loader2 className="w-3 h-3 animate-spin" /> : s.status === 'ready' ? <CheckCircle2 className="w-3 h-3" /> : s.status === 'queued' ? <Clock className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {IMPORT_STATUS_LABELS[s.status]}
                    </span>
                    <span className="px-1.5 py-0.5 rounded border border-slate-700 text-[10px] text-slate-300 font-semibold">{s.program}</span>
                    <span className="text-[11px] text-slate-500">{s.subjectId === 'auto' ? 'subject per question' : SUBJECT_NAMES[s.subjectId]}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {s.fileSize}
                    {s.counts.pages ? ` · ${s.counts.pages} pages` : ''}
                    {s.draftOrder.length ? ` · ${s.counts.extracted} questions · ${s.counts.answered} answered · ${s.counts.solved} solved · ${s.counts.approved} approved · ${s.counts.published} published` : ''}
                    {s.counts.needVerification ? <span className="text-amber-300"> · {s.counts.needVerification} need verification</span> : null}
                    {s.counts.duplicates ? <span className="text-fuchsia-300"> · {s.counts.duplicates} duplicates</span> : null}
                  </div>
                  {s.status === 'extracting' && p && <div className="mt-1 text-[11px] text-indigo-300">{p.stage}</div>}
                  {s.status === 'answering' && s.answering && (
                    <div className="mt-1 text-[11px] text-indigo-300">
                      AI answers {s.answering.done}/{s.answering.total}
                      {s.answering.failed ? `, ${s.answering.failed} failed` : ''}
                    </div>
                  )}
                  {s.error && (s.status === 'error' || s.status === 'interrupted') && <div className="mt-1 text-[11px] text-rose-300">{s.error}</div>}
                </button>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {(s.draftOrder.length > 0 || s.status === 'ready') && (
                    <button onClick={() => onOpen(s.id)} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Review
                    </button>
                  )}
                  {(s.status === 'error' || s.status === 'interrupted') && (
                    <button onClick={() => onRetry(s.id)} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1">
                      <RotateCcw className="w-3.5 h-3.5" /> Retry
                    </button>
                  )}
                  {running && (
                    <button onClick={() => onCancel(s.id)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1">
                      <Square className="w-3 h-3" /> Stop
                    </button>
                  )}
                  <button onClick={() => setLogsFor(logsFor === s.id ? null : s.id)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Processing log" aria-label="Processing log" aria-expanded={logsFor === s.id}>
                    <ScrollText className="w-3.5 h-3.5" />
                  </button>
                  {!running && (
                    <button onClick={() => onDelete(s)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-700 text-slate-300 hover:text-white" title="Delete this import" aria-label={`Delete import ${s.filename}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {(running || s.status === 'ready') && (
                <div className="mt-2.5 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden" aria-hidden>
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${s.status === 'ready' ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-400'} ${running ? 'animate-pulse' : ''}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
              {logsFor === s.id && (
                <ol className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-2.5 space-y-1 font-mono text-[10px]">
                  {[...s.logs].reverse().map((entry, i) => (
                    <li key={i} className={entry.level === 'error' ? 'text-rose-300' : 'text-slate-400'}>
                      <span className="text-slate-600">{new Date(entry.at).toLocaleString()}</span> {entry.message}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
