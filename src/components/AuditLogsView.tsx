/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck, Clock, FileText, CheckCircle2, User } from 'lucide-react';
import { AuditLog } from '../types/index.ts';

interface Props {
  auditLogs: AuditLog[];
}

export const AuditLogsView: React.FC<Props> = ({ auditLogs }) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            Integrity & Security
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            System & Examination Audit Trail
          </h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Immutable log of all PDF questionnaire extractions, AI answer verifications, manual corrections, and question publications.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
        {auditLogs.map((log) => (
          <div
            key={log.id}
            className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold text-white">{log.action}</span>
                {log.badge && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                    {log.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{log.details}</p>
              <div className="text-[11px] text-slate-500 flex items-center gap-2 font-mono">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3 text-slate-400" />
                  {log.adminName}
                </span>
              </div>
            </div>

            <div className="text-right text-[11px] font-mono text-slate-500 whitespace-nowrap">
              {log.timestamp}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
