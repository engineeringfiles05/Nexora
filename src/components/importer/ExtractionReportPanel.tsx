/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ExtractionReport, ExtractionReportStatus } from '../../types/index.ts';

const VERDICT: Record<ExtractionReportStatus, { title: string; detail: string; cls: string; Icon: React.FC<{ className?: string }> }> = {
  verified: {
    title: 'Verified',
    detail: 'Every question was confirmed against the original PDF, by two matching independent readings or by an administrator.',
    cls: 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200',
    Icon: CheckCircle2,
  },
  needs_review: {
    title: 'Needs review',
    detail: 'Nothing is known to be missing, but some questions have not been confirmed against the PDF yet or two readings disagree.',
    cls: 'bg-amber-950/30 border-amber-700/60 text-amber-200',
    Icon: AlertTriangle,
  },
  incomplete: {
    title: 'Incomplete',
    detail: 'Questions, choices or pages are missing or could not be read. Fix or confirm them before publishing.',
    cls: 'bg-rose-950/30 border-rose-700/60 text-rose-200',
    Icon: AlertOctagon,
  },
  failed: {
    title: 'Failed',
    detail: 'The extraction could not be completed reliably. Nothing from this document should be published.',
    cls: 'bg-rose-950/50 border-rose-600 text-rose-100',
    Icon: XCircle,
  },
};

interface Props {
  report: ExtractionReport;
  onAddMissing: (n: number) => void;
  onAcknowledgeMissing: (n: number) => void;
  onGoToPage: (page: number) => void;
}

export const ExtractionReportPanel: React.FC<Props> = ({ report, onAddMissing, onAcknowledgeMissing, onGoToPage }) => {
  const v = VERDICT[report.overallStatus];
  const metrics: [string, React.ReactNode, string?][] = [
    ['File', <span className="text-sm break-all">{report.filename}</span>],
    ['Pages', report.totalPages],
    ['Questions detected', report.totalQuestionsDetected],
    ['Extracted complete', report.totalQuestionsExtracted, 'text-indigo-300'],
    ['Answer choices', report.totalChoicesDetected, 'text-emerald-300'],
    ['Need verification', report.questionsRequiringVerification, 'text-amber-300'],
    ['Incomplete', report.incompleteQuestionsCount, 'text-rose-300'],
    ['Cross-checked', report.crossCheckedCount ?? 0, 'text-emerald-300'],
    ['Approved by admin', report.approvedCount ?? 0, 'text-emerald-300'],
    ['Pages with reading issues', (report.pagesWithOcrIssues ?? []).length ? (report.pagesWithOcrIssues ?? []).join(', ') : '—', 'text-amber-300'],
  ];

  return (
    <div className="space-y-5">
      <div className={`p-5 rounded-2xl border flex gap-3 ${v.cls}`}>
        <v.Icon className="w-7 h-7 shrink-0" />
        <div className="space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider opacity-80">Overall extraction status</div>
          <h3 className="text-xl font-bold text-white">{v.title}</h3>
          <p className="text-xs">{v.detail}</p>
          <p className="text-[11px] opacity-80">
            Engine: {report.engineUsed} · {new Date(report.extractionTimestamp).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {metrics.map(([label, value, cls]) => (
          <div key={label} className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">{label}</div>
            <div className={`text-xl font-mono font-bold ${cls ?? 'text-white'}`}>{value}</div>
          </div>
        ))}
      </div>

      {(report.missingQuestionNumbers ?? []).length > 0 && (
        <section className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 space-y-2 text-xs">
          <h4 className="font-bold text-rose-200">Missing question numbers</h4>
          <p className="text-rose-200/80">
            These numbers fall inside the document's numbering but were not found. Add each one from the PDF, or confirm the PDF skips it too.
          </p>
          <div className="flex flex-wrap gap-2">
            {report.missingQuestionNumbers!.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-lg border border-rose-800/60 bg-slate-950 pl-2">
                <span className="font-mono font-bold text-white">#{n}</span>
                <button onClick={() => onAddMissing(n)} className="px-2 py-1 text-indigo-300 hover:text-white font-semibold">
                  Add
                </button>
                <button onClick={() => onAcknowledgeMissing(n)} className="px-2 py-1 text-slate-400 hover:text-white border-l border-slate-800">
                  Not in PDF
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {(report.warnings ?? []).length > 0 && (
        <section className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs space-y-1.5">
          <h4 className="font-bold text-amber-200">Warnings</h4>
          <ul className="list-disc pl-5 space-y-1 text-amber-100/90">
            {report.warnings!.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {report.notes.length > 0 && (
        <section className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
          {report.notes.map((n, i) => (
            <p key={i} className="text-slate-300">
              {n}
            </p>
          ))}
        </section>
      )}

      {(report.pages ?? []).length > 0 && (
        <section className="rounded-xl border border-slate-800 overflow-hidden">
          <h4 className="px-4 py-2.5 bg-slate-900 text-xs font-bold text-white">Page by page</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-950 text-slate-400 text-left">
                <tr>
                  <th className="px-3 py-2">Page</th>
                  <th className="px-3 py-2">Read from</th>
                  <th className="px-3 py-2">Questions</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 min-w-[16rem]">Findings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {report.pages!.map((p) => (
                  <tr key={p.page} className="align-top">
                    <td className="px-3 py-2">
                      <button onClick={() => onGoToPage(p.page)} className="font-mono text-indigo-300 hover:text-white underline-offset-2 hover:underline">
                        {p.page}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                      {p.method === 'native'
                        ? 'Text layer'
                        : p.method === 'native+ocr'
                          ? 'Text layer + image check'
                          : p.method === 'ocr'
                            ? 'Page image (scan)'
                            : p.method === 'text'
                              ? 'Text file'
                              : 'Not read'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">{p.questionNumbers.length ? p.questionNumbers.join(', ') : '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          p.status === 'ok' ? 'bg-emerald-950 text-emerald-300' : p.status === 'warning' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400 space-y-1">
                      {p.issues.map((i, k) => (
                        <div key={k}>{i}</div>
                      ))}
                      {p.removedLines.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-slate-500">{p.removedLines.length} header/footer line(s) left out of questions</summary>
                          <ul className="mt-1 font-mono text-[11px] text-slate-500">
                            {p.removedLines.map((l, k) => (
                              <li key={k}>{l}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
