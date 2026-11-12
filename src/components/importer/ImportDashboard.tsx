/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, BookOpenCheck, CheckCircle2, Copy, FileStack, FileText, Layers, Loader2, ScanSearch, XCircle } from 'lucide-react';
import type { ImportTotals } from '../../utils/importSessions.ts';

/** Totals across every saved import: what was read, extracted, answered and still needs a person. */
export const ImportDashboard: React.FC<{ totals: ImportTotals; loading: boolean }> = ({ totals, loading }) => {
  const tiles: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone?: 'warn' | 'bad' | 'good' }[] = [
    { label: 'PDF files', value: totals.files, icon: FileStack },
    { label: 'Pages analyzed', value: totals.pages, icon: FileText },
    { label: 'Questions detected', value: totals.detected, icon: ScanSearch },
    { label: 'Extracted', value: totals.extracted, icon: Layers },
    { label: 'With answers', value: totals.answered, icon: CheckCircle2, tone: 'good' },
    { label: 'With solutions', value: totals.solved, icon: BookOpenCheck, tone: 'good' },
    { label: 'Need verification', value: totals.needVerification, icon: AlertTriangle, tone: totals.needVerification ? 'warn' : undefined },
    { label: 'Duplicates', value: totals.duplicates, icon: Copy, tone: totals.duplicates ? 'warn' : undefined },
    { label: 'Processing errors', value: totals.errors, icon: XCircle, tone: totals.errors ? 'bad' : undefined },
  ];
  const tone = { good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-rose-300' } as const;
  return (
    <section aria-label="Import totals" className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="font-semibold uppercase tracking-wider text-[11px]">Processing dashboard</span>
        {totals.inProgress > 0 && (
          <span className="flex items-center gap-1.5 text-indigo-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {totals.inProgress} file{totals.inProgress === 1 ? '' : 's'} processing in the background
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9 gap-2">
        {tiles.map(({ label, value, icon: Icon, tone: t }) => (
          <div key={label} className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-slate-400 leading-tight">{label}</span>
              <Icon className={`w-3.5 h-3.5 shrink-0 ${t ? tone[t] : 'text-slate-500'}`} />
            </div>
            <div className={`mt-1 text-xl font-extrabold tabular-nums ${t && value ? tone[t] : 'text-white'}`}>{loading ? '–' : value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  );
};
