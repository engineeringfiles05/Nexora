/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User Approval Management: every registration waits here until the administrator approves
 * or rejects it. Also suspends, deactivates and reactivates approved accounts. Changes are
 * written to Firestore (enforced by firestore.rules) and to the activity log, and take effect
 * at once on the person's open session.
 */

import React, { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Clock, Hourglass, Inbox, Loader2, Mail, PauseCircle, Phone, RotateCcw, Search, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import type { UserProfile, UserStatus } from '../../types/index.ts';
import { STATUS_LABELS, statusOf } from '../../auth/accountStatus.ts';
import { computeUserStats } from '../../utils/userAdmin.ts';
import { Avatar } from '../Avatar.tsx';
import { StatusBadge, formatDateTime, formatRelative } from './userUi.tsx';
import { useAccountActions, type UserLogEntry } from './useAccountActions.tsx';

interface Props {
  users: UserProfile[];
  loading: boolean;
  error?: string;
  admin: UserProfile;
  onLog: (entry: UserLogEntry) => void;
}

type Tab = UserStatus | 'all';

const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'inactive', label: 'Deactivated' },
  { id: 'all', label: 'All' },
];

/** Registrations awaiting a decision, oldest first, so nobody waits longest unnoticed. */
export function pendingQueue(users: UserProfile[]): UserProfile[] {
  return users.filter((u) => u.role !== 'admin' && statusOf(u) === 'pending').sort((a, b) => Date.parse(a.enrolledAt) - Date.parse(b.enrolledAt));
}

export const UserApprovalsView: React.FC<Props> = ({ users: allUsers, loading, error, admin, onLog }) => {
  const users = useMemo(() => allUsers.filter((u) => u.id !== admin.id && u.role !== 'admin'), [allUsers, admin.id]);
  const [tab, setTab] = useState<Tab>('pending');
  const [search, setSearch] = useState('');
  const { requestStatus, elements } = useAccountActions(onLog);
  const stats = useMemo(() => computeUserStats(users), [users]);
  const now = Date.now();

  const shown = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = tab === 'pending' ? pendingQueue(users) : users.filter((u) => tab === 'all' || statusOf(u) === tab);
    const sorted = tab === 'pending' ? list : [...list].sort((a, b) => Date.parse(b.enrolledAt) - Date.parse(a.enrolledAt));
    return terms.length ? sorted.filter((u) => terms.every((t) => `${u.name} ${u.email} ${u.course ?? ''}`.toLowerCase().includes(t))) : sorted;
  }, [users, tab, search]);

  const count = (t: Tab) => (t === 'all' ? stats.total : stats[t]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            User Approval Management
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Registration requests</h1>
          <p className="text-xs text-slate-400 max-w-xl">
            New accounts can't use NEXORA Academy until you approve them. Rejected, suspended and deactivated accounts stay restricted until you reactivate them.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {(['pending', 'active', 'rejected', 'suspended'] as const).map((s) => (
            <div key={s} className="rounded-xl bg-slate-950/60 border border-slate-800 px-4 py-2.5 min-w-[96px]">
              <div className="text-[10px] text-slate-500">{STATUS_LABELS[s]}</div>
              <div className={`text-xl font-extrabold tabular-nums ${s === 'pending' && stats.pending ? 'text-amber-300' : 'text-white'}`}>{loading ? '–' : stats[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by account status">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition flex items-center gap-1.5 ${tab === t.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950/60 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              {t.label}
              <span className={`px-1.5 rounded-full text-[10px] tabular-nums ${t.id === 'pending' && stats.pending ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{count(t.id)}</span>
            </button>
          ))}
        </div>
        <label className="relative lg:w-80">
          <span className="sr-only">Search by name, email or course</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, course…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 outline-none"
          />
        </label>
      </section>

      {error ? (
        <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 px-5 py-6 text-center text-sm text-rose-100">
          {error}
        </p>
      ) : loading ? (
        <p className="py-12 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading registrations…
        </p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-14 text-center">
          <Inbox className="w-8 h-8 mx-auto text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">{tab === 'pending' && !search ? 'No registrations are waiting for approval.' : 'No accounts match.'}</p>
          {tab === 'pending' && !search && <p className="text-xs text-slate-500 mt-1">New registrations appear here as soon as they are made.</p>}
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {shown.map((user) => (
            <ApprovalCard key={user.id} user={user} now={now} onStatus={(status) => requestStatus(user, status)} />
          ))}
        </ul>
      )}
      {elements}
    </div>
  );
};

export const ApprovalCard: React.FC<{ user: UserProfile; now: number; onStatus: (s: UserStatus) => void; compact?: boolean }> = ({ user, now, onStatus, compact }) => {
  const status = statusOf(user);
  return (
    <li className={`rounded-2xl border bg-slate-900 p-5 flex flex-col gap-4 ${status === 'pending' ? 'border-amber-700/40' : 'border-slate-800'}`}>
      <div className="flex items-start gap-3">
        <Avatar name={user.name} src={user.avatar} className="w-11 h-11 border border-slate-700" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-white truncate">{user.name}</h3>
            <StatusBadge status={status} />
          </div>
          <dl className="mt-1.5 space-y-1 text-xs text-slate-400">
            <div className="flex items-center gap-1.5 min-w-0">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <dd className="truncate text-slate-300">{user.email}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <dd>
                Registered <span className="text-slate-300">{formatDateTime(user.enrolledAt)}</span> · {formatRelative(user.enrolledAt, now)}
              </dd>
            </div>
            {!compact && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Course: <strong className="text-slate-200">{user.course ?? 'not chosen'}</strong>
                </span>
                {user.contactNumber && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {user.contactNumber}
                  </span>
                )}
                <span>{user.authProvider === 'google.com' ? 'Signed up with Google' : 'Email and password'}</span>
              </div>
            )}
          </dl>
          {user.statusReason && status !== 'active' && status !== 'pending' && <p className="mt-2 text-xs text-amber-200">Reason: {user.statusReason}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(status === 'pending' || status === 'rejected') && (
          <button onClick={() => onStatus('active')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white">
            <CheckCircle2 className="w-4 h-4" /> Approve Account
          </button>
        )}
        {status === 'pending' && (
          <button onClick={() => onStatus('rejected')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-600 text-xs font-bold text-white">
            <XCircle className="w-4 h-4" /> Reject Account
          </button>
        )}
        {status === 'active' && (
          <>
            <button onClick={() => onStatus('suspended')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600/90 hover:bg-amber-500 text-xs font-bold text-white">
              <Ban className="w-4 h-4" /> Suspend Account
            </button>
            <button onClick={() => onStatus('inactive')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white">
              <PauseCircle className="w-4 h-4" /> Deactivate
            </button>
          </>
        )}
        {(status === 'suspended' || status === 'inactive') && (
          <button onClick={() => onStatus('active')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white">
            <RotateCcw className="w-4 h-4" /> Reactivate Account
          </button>
        )}
      </div>
    </li>
  );
};

/** Admin Dashboard notification: pending registrations with quick approve and reject. */
export const PendingRegistrationsPanel: React.FC<{ users: UserProfile[]; onLog: (entry: UserLogEntry) => void; onOpenApprovals: () => void }> = ({ users, onLog, onOpenApprovals }) => {
  const queue = pendingQueue(users);
  const { requestStatus, elements } = useAccountActions(onLog);
  if (queue.length === 0) return <>{elements}</>;
  const latest = [...queue].reverse().slice(0, 3);
  return (
    <section aria-label="Pending registrations" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
      <div className="rounded-3xl border border-amber-700/50 bg-gradient-to-br from-amber-950/50 to-slate-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
              <Hourglass className="w-5 h-5 text-amber-300" />
              <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center justify-center tabular-nums">{queue.length}</span>
            </span>
            <div>
              <h2 className="text-base font-bold text-white">
                {queue.length} registration{queue.length === 1 ? '' : 's'} waiting for approval
              </h2>
              <p className="text-xs text-amber-100/80">These accounts can't use NEXORA Academy until you approve them.</p>
            </div>
          </div>
          <button onClick={onOpenApprovals} className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
            <UserCheck className="w-4 h-4" /> Review all requests
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {latest.map((user) => (
            <ApprovalCard key={user.id} user={user} now={Date.now()} compact onStatus={(status) => requestStatus(user, status)} />
          ))}
        </ul>
      </div>
      {elements}
    </section>
  );
};
