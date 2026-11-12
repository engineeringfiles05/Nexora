/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { ShieldCheck, Search, User, UserCog } from 'lucide-react';
import { AuditLog } from '../types/index.ts';

interface Props {
  auditLogs: AuditLog[];
}

type Category = 'all' | 'users' | 'content';

/** Entries from account management, including those written before categories existed. */
export function isUserLog(log: AuditLog): boolean {
  return log.category === 'users' || Boolean(log.targetUserId);
}

export function logTime(log: AuditLog): string {
  const t = log.createdAt ? Date.parse(log.createdAt) : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : log.timestamp;
}

export const AuditLogsView: React.FC<Props> = ({ auditLogs }) => {
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const terms = search.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (category === 'users' && !isUserLog(log)) return false;
      if (category === 'content' && isUserLog(log)) return false;
      if (!terms) return true;
      return `${log.action} ${log.details} ${log.adminName} ${log.targetUserName ?? ''} ${log.targetUserEmail ?? ''}`.toLowerCase().includes(terms);
    });
  }, [auditLogs, category, search]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            Integrity & Security
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Activity Logs</h1>
          <p className="text-xs text-slate-400 max-w-xl">
            Every administrative action: account creation, edits, activation, suspension, course changes and deletion, plus PDF extractions, answer approvals and question publications.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter activity">
            {(
              [
                ['all', 'All activity'],
                ['users', 'User accounts'],
                ['content', 'Questions & PDFs'],
              ] as [Category, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                aria-pressed={category === id}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition select-none ${category === id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950/60 border-slate-700 text-slate-300 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative sm:w-72 select-text">
            <span className="sr-only">Search activity</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action, user, details…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950/70 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 outline-none"
            />
          </label>
        </div>

        {shown.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">No activity recorded{category !== 'all' || search ? ' for this filter' : ' yet'}.</p>}

        <div className="space-y-3 select-text">
          {shown.map((log) => (
            <div
              key={log.id}
              className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-bold text-white">{log.action}</span>
                  {log.badge && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                      {log.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed break-words">{log.details}</p>
                <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-400" />
                    By {log.adminName}
                  </span>
                  {log.targetUserName && (
                    <span className="flex items-center gap-1">
                      <UserCog className="w-3 h-3 text-slate-400" />
                      Affected: {log.targetUserName}
                      {log.targetUserEmail ? ` (${log.targetUserEmail})` : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right text-[11px] font-mono text-slate-500 whitespace-nowrap">{logTime(log)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
