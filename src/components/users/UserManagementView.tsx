/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin User Management: every reviewee account, with statistics, search and filters, and
 * the account actions. Each action really changes the account (see auth/adminUsers.ts and
 * utils/adminApi.ts) and is written to the activity log; the list updates live from
 * Firestore, so what is shown is what is stored.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Hourglass,
  Loader2,
  PauseCircle,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { ExamResult, Subject, UserProfile, UserStatus } from '../../types/index.ts';
import { STATUS_LABELS, statusOf } from '../../auth/accountStatus.ts';
import { describeAuthError } from '../../auth/validation.ts';
import {
  createReviewee,
  deleteAccountRecords,
  resendSetupEmail,
  setAccountStatus,
  setRequireApproval,
  updateRevieweeProfile,
  watchRegistrationSettings,
} from '../../auth/adminUsers.ts';
import { AdminApiError, deleteAuthAccount, getAdminCapabilities, setSignInBlocked, setSignInEmail } from '../../utils/adminApi.ts';
import {
  DEFAULT_USER_QUERY,
  computeUserStats,
  filterUsers,
  paginate,
  weeklyRegistrations,
  type QuickFilter,
  type SortKey,
  type UserQuery,
} from '../../utils/userAdmin.ts';
import { Avatar } from '../Avatar.tsx';
import { BarChart } from './MiniCharts.tsx';
import { AddUserModal, DeleteUserModal, EditUserModal, StatusModal, type AddUserValues, type EditUserValues } from './UserModals.tsx';
import { UserDetailsPanel } from './UserDetailsPanel.tsx';
import { StatusBadge, formatDate, formatRelative } from './userUi.tsx';

export type UserLogEntry = { action: string; details: string; badge?: string; target?: Pick<UserProfile, 'id' | 'name' | 'email'> };

interface Props {
  /** Every profile in Firestore (live). The administrator's own is filtered out here. */
  users: UserProfile[];
  loading: boolean;
  error?: string;
  examResults: ExamResult[];
  subjects: Subject[];
  admin: UserProfile;
  onLog: (entry: UserLogEntry) => void;
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; user: UserProfile }
  | { kind: 'status'; user: UserProfile; status: UserStatus }
  | { kind: 'delete'; user: UserProfile };

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: 'all', label: 'All users' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'pending', label: 'Pending approval' },
  { id: 'recent', label: 'Recently registered' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'enrolledAt', label: 'Registration date' },
  { id: 'name', label: 'Name' },
  { id: 'email', label: 'Email' },
  { id: 'status', label: 'Status' },
  { id: 'lastLoginAt', label: 'Last login' },
];

function errorText(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'permission-denied') return 'Firestore refused the change. Make sure the latest firestore.rules are published.';
  if (code.startsWith('auth/')) return describeAuthError(error);
  return 'The change could not be saved. Check your connection and try again.';
}

export const UserManagementView: React.FC<Props> = ({ users: allUsers, loading, error, examResults, subjects, admin, onLog }) => {
  const users = useMemo(() => allUsers.filter((u) => u.id !== admin.id && u.role !== 'admin'), [allUsers, admin.id]);
  const [query, setQuery] = useState<UserQuery>(DEFAULT_USER_QUERY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [serviceAccount, setServiceAccount] = useState<boolean | null>(null);
  const [requireApproval, setRequireApprovalState] = useState<boolean | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getAdminCapabilities().then((c) => setServiceAccount(c.serviceAccount));
    const unsubscribe = watchRegistrationSettings(
      (s) => setRequireApprovalState(s.requireApproval),
      () => setRequireApprovalState(false)
    );
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubscribe();
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === 'error' ? 12_000 : 7_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const stats = useMemo(() => computeUserStats(users, now), [users, now]);
  const weekly = useMemo(() => weeklyRegistrations(users, 8, now), [users, now]);
  const filtered = useMemo(() => filterUsers(users, query, now), [users, query, now]);
  const paged = paginate(filtered, page, pageSize);
  const resultCounts = useMemo(() => {
    const counts = new Map<string, { count: number; total: number }>();
    for (const r of examResults) {
      const c = counts.get(r.userId) ?? { count: 0, total: 0 };
      c.count += 1;
      c.total += r.scorePercentage;
      counts.set(r.userId, c);
    }
    return counts;
  }, [examResults]);
  const selected = selectedId ? users.find((u) => u.id === selectedId) ?? null : null;

  const update = (patch: Partial<UserQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
    setPage(1);
  };

  // ----- Actions -----

  const handleCreate = async (values: AddUserValues): Promise<string | null> => {
    try {
      const { profile, setupEmailSent } = await createReviewee({ ...values, contactNumber: values.contactNumber || undefined }, admin.id);
      onLog({ action: 'User Account Created', details: `Created ${profile.course} reviewee account for ${profile.name} (${profile.email}).`, badge: 'Users', target: profile });
      setDialog(null);
      setNotice({
        tone: setupEmailSent ? 'success' : 'info',
        text: setupEmailSent
          ? `Account created for ${profile.name}. A link to choose a password was emailed to ${profile.email}.`
          : `Account created for ${profile.name}, but the password email could not be sent. Open their profile and choose "Send password link".`,
      });
      return null;
    } catch (err) {
      return (err as { code?: string })?.code === 'auth/email-already-in-use'
        ? 'An account with this email address already exists.'
        : errorText(err);
    }
  };

  /** Firestore first (it is what blocks access), then the Auth-level sign-in block if available. */
  const applyStatus = async (user: UserProfile, status: UserStatus, reason: string): Promise<string | null> => {
    const before = statusOf(user);
    try {
      await setAccountStatus(user.id, status, reason);
    } catch (err) {
      return errorText(err);
    }
    let authNote = '';
    if (serviceAccount) {
      try {
        await setSignInBlocked(user.id, status !== 'active');
      } catch (err) {
        authNote = ` The status is saved and enforced, but blocking sign-in at Firebase Authentication failed: ${errorText(err)}`;
      }
    }
    const action =
      status === 'active'
        ? before === 'suspended'
          ? 'Account Restored'
          : before === 'pending'
            ? 'Account Approved'
            : 'Account Activated'
        : status === 'suspended'
          ? 'Account Suspended'
          : status === 'inactive'
            ? 'Account Deactivated'
            : 'Account Set to Pending';
    onLog({
      action,
      details: `${user.name} (${user.email}): ${STATUS_LABELS[before]} → ${STATUS_LABELS[status]}.${reason.trim() && status !== 'active' ? ` Reason: ${reason.trim()}` : ''}`,
      badge: 'Users',
      target: user,
    });
    setNotice({ tone: authNote ? 'info' : 'success', text: `${action}: ${user.name}.${authNote}` });
    return null;
  };

  const handleEdit = async (user: UserProfile, values: EditUserValues): Promise<string | null> => {
    const emailChanged = values.email.trim().toLowerCase() !== user.email.toLowerCase();
    try {
      if (emailChanged) await setSignInEmail(user.id, values.email.trim());
      await updateRevieweeProfile(user.id, { name: values.name, course: values.course, contactNumber: values.contactNumber, ...(emailChanged ? { email: values.email } : {}) });
    } catch (err) {
      return errorText(err);
    }
    const changes: string[] = [];
    if (values.name.trim() !== user.name) changes.push(`name "${user.name}" → "${values.name.trim()}"`);
    if (emailChanged) changes.push(`email ${user.email} → ${values.email.trim().toLowerCase()}`);
    if ((values.contactNumber || '') !== (user.contactNumber || '')) changes.push('contact number');
    if (changes.length) onLog({ action: 'User Information Updated', details: `${user.name}: ${changes.join(', ')}.`, badge: 'Users', target: user });
    const courseBefore = user.course ?? null;
    if (values.course !== courseBefore) {
      onLog({
        action: values.course ? 'Course Assignment Changed' : 'Course Access Removed',
        details: `${user.name}: ${courseBefore ?? 'none'} → ${values.course ?? 'none'}.`,
        badge: 'Course',
        target: user,
      });
    }
    if (values.status !== statusOf(user)) {
      const err = await applyStatus(user, values.status, user.statusReason ?? '');
      if (err) return err;
    } else {
      setNotice({ tone: 'success', text: `Saved changes for ${values.name.trim()}.` });
    }
    setDialog(null);
    return null;
  };

  const handleDelete = async (user: UserProfile): Promise<string | null> => {
    const results = resultCounts.get(user.id)?.count ?? 0;
    try {
      await deleteAuthAccount(user.id);
      await deleteAccountRecords(user.id);
    } catch (err) {
      return errorText(err);
    }
    onLog({
      action: 'User Account Deleted',
      details: `Permanently deleted ${user.name} (${user.email}), course ${user.course ?? 'none'}, with ${results} examination result${results === 1 ? '' : 's'}.`,
      badge: 'Deleted',
      target: user,
    });
    setDialog(null);
    setSelectedId(null);
    setNotice({ tone: 'success', text: `${user.name}'s account was permanently deleted.` });
    return null;
  };

  const handleResend = async (user: UserProfile) => {
    setResendBusy(true);
    try {
      await resendSetupEmail(user.email);
      onLog({ action: 'Password Link Sent', details: `Sent a password set-up link to ${user.email}.`, badge: 'Users', target: user });
      setNotice({ tone: 'success', text: `A password link was emailed to ${user.email}.` });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setResendBusy(false);
    }
  };

  const toggleApproval = async () => {
    if (requireApproval === null) return;
    setApprovalBusy(true);
    try {
      await setRequireApproval(!requireApproval);
      onLog({
        action: !requireApproval ? 'Registration Approval Enabled' : 'Registration Approval Disabled',
        details: !requireApproval ? 'New public registrations now wait for administrator approval.' : 'New public registrations are active immediately.',
        badge: 'Settings',
      });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setApprovalBusy(false);
    }
  };

  // ----- Render -----

  const dialogs = (
    <>
      {dialog?.kind === 'add' && <AddUserModal onClose={() => setDialog(null)} onCreate={handleCreate} />}
      {dialog?.kind === 'edit' && (
        <EditUserModal user={dialog.user} canChangeEmail={serviceAccount === true} onClose={() => setDialog(null)} onSave={(v) => handleEdit(dialog.user, v)} />
      )}
      {dialog?.kind === 'status' && (
        <StatusModal
          user={dialog.user}
          status={dialog.status}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const err = await applyStatus(dialog.user, dialog.status, reason);
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteUserModal
          user={dialog.user}
          resultCount={resultCounts.get(dialog.user.id)?.count ?? 0}
          canDelete={serviceAccount === true}
          onClose={() => setDialog(null)}
          onConfirm={() => handleDelete(dialog.user)}
          onDeactivateInstead={() => setDialog({ kind: 'status', user: dialog.user, status: 'inactive' })}
        />
      )}
      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md rounded-2xl border px-4 py-3 shadow-2xl text-sm flex items-start gap-3 bg-slate-900/95 backdrop-blur ${
            notice.tone === 'error' ? 'border-rose-700/60 text-rose-100' : notice.tone === 'info' ? 'border-amber-700/60 text-amber-100' : 'border-emerald-700/60 text-slate-100'
          }`}
        >
          <span className="flex-1 leading-relaxed">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );

  if (selected) {
    return (
      <>
        <UserDetailsPanel
          user={selected}
          examResults={examResults}
          subjects={subjects}
          onBack={() => setSelectedId(null)}
          onEdit={() => setDialog({ kind: 'edit', user: selected })}
          onChangeStatus={(status) => setDialog({ kind: 'status', user: selected, status })}
          onResendSetup={() => handleResend(selected)}
          resendBusy={resendBusy}
        />
        {dialogs}
      </>
    );
  }

  const cards: { id: QuickFilter; label: string; value: number; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
    { id: 'all', label: 'Total registered', value: stats.total, icon: Users, accent: 'text-indigo-300' },
    { id: 'active', label: 'Active', value: stats.active, icon: CheckCircle2, accent: 'text-emerald-300' },
    { id: 'inactive', label: 'Inactive', value: stats.inactive, icon: PauseCircle, accent: 'text-slate-300' },
    { id: 'pending', label: 'Pending approval', value: stats.pending, icon: Hourglass, accent: 'text-amber-300' },
    { id: 'suspended', label: 'Suspended', value: stats.suspended, icon: Ban, accent: 'text-rose-300' },
    { id: 'recent', label: 'New (7 days)', value: stats.newlyRegistered, icon: Sparkles, accent: 'text-sky-300' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            User Management
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Reviewee accounts</h1>
          <p className="text-xs text-slate-400 max-w-xl">Create, edit, activate, suspend and remove reviewee accounts, assign courses, and follow each reviewee's progress.</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5">
            <button
              role="switch"
              aria-checked={requireApproval === true}
              onClick={toggleApproval}
              disabled={requireApproval === null || approvalBusy}
              className={`relative w-9 h-5 rounded-full transition ${requireApproval ? 'bg-amber-500' : 'bg-slate-700'} disabled:opacity-50`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${requireApproval ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <span>
              <span className="block font-semibold text-white">Approve new registrations</span>
              <span className="block text-[10px] text-slate-400">{requireApproval ? 'New accounts wait for you' : 'New accounts are active at once'}</span>
            </span>
          </label>
          <button
            onClick={() => setDialog({ kind: 'add' })}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30"
          >
            <UserPlus className="w-4 h-4" /> Add reviewee
          </button>
        </div>
      </div>

      {serviceAccount === false && (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-100 leading-relaxed">
          <strong className="text-amber-50">Limited mode:</strong> changing a reviewee's sign-in email and permanently deleting accounts need Firebase Admin credentials on the server
          (<code className="font-mono">FIREBASE_SERVICE_ACCOUNT</code>, see <code className="font-mono">.env.example</code>). Everything else works now, and deactivated or
          suspended accounts are already blocked by the security rules.
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const active = query.quick === card.id;
          return (
            <button
              key={card.id}
              onClick={() => update({ quick: card.id })}
              aria-pressed={active}
              className={`text-left rounded-2xl border p-4 transition hover:-translate-y-0.5 ${active ? 'bg-slate-800 border-indigo-500/60 shadow-lg shadow-indigo-900/30' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                <Icon className={`w-4 h-4 ${card.accent}`} />
              </div>
              <div className="mt-2 text-2xl font-extrabold text-white tabular-nums">{loading ? '–' : card.value}</div>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-white">New registrations per week</h2>
            <span className="text-[11px] text-slate-500">Last 8 weeks</span>
          </div>
          <div className="mt-3">
            <BarChart
              ariaLabel="New registrations per week, last 8 weeks"
              data={weekly.map((w) => ({ label: new Date(w.start + 7 * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: w.count }))}
              valueLabel={(v) => `${v} new account${v === 1 ? '' : 's'}`}
            />
          </div>
        </section>
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-bold text-white">Accounts at a glance</h2>
          <StatusSplit stats={stats} />
          <dl className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-2.5">
              <dt className="text-[10px] text-slate-500">REE</dt>
              <dd className="text-lg font-bold text-white tabular-nums">{stats.byCourse.REE}</dd>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-2.5">
              <dt className="text-[10px] text-slate-500">RME</dt>
              <dd className="text-lg font-bold text-white tabular-nums">{stats.byCourse.RME}</dd>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-2.5">
              <dt className="text-[10px] text-slate-500">No course</dt>
              <dd className="text-lg font-bold text-white tabular-nums">{stats.byCourse.none}</dd>
            </div>
          </dl>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5" /> <strong className="text-white tabular-nums">{stats.recentlyActive}</strong> signed in during the last 7 days
          </p>
        </section>
      </div>

      {/* Filters */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => update({ quick: f.id })}
              aria-pressed={query.quick === f.id}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${query.quick === f.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950/60 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1.3fr] gap-3">
          <label className="relative">
            <span className="sr-only">Search by name, email, course or status</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={query.search}
              onChange={(e) => update({ search: e.target.value })}
              placeholder="Search name, email, course, status…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 outline-none"
            />
          </label>
          <Select label="Course" value={query.course} onChange={(v) => update({ course: v as UserQuery['course'] })} options={[['any', 'All courses'], ['REE', 'REE'], ['RME', 'RME'], ['none', 'No course']]} />
          <DateInput label="Registered from" value={query.registeredFrom ?? ''} onChange={(v) => update({ registeredFrom: v || undefined })} />
          <DateInput label="Registered to" value={query.registeredTo ?? ''} onChange={(v) => update({ registeredTo: v || undefined })} />
          <div className="flex gap-2">
            <Select label="Sort by" value={query.sort} onChange={(v) => update({ sort: v as SortKey })} options={SORTS.map((s) => [s.id, s.label])} />
            <button
              onClick={() => update({ direction: query.direction === 'asc' ? 'desc' : 'asc' })}
              title={query.direction === 'asc' ? 'Ascending' : 'Descending'}
              aria-label={`Sort ${query.direction === 'asc' ? 'ascending' : 'descending'}; switch direction`}
              className="self-end shrink-0 p-2.5 rounded-xl bg-slate-950/70 border border-slate-700 text-slate-300 hover:text-white"
            >
              <ArrowDownUp className={`w-4 h-4 transition ${query.direction === 'asc' ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {(query.search || query.quick !== 'all' || query.course !== 'any' || query.registeredFrom || query.registeredTo) && (
          <button onClick={() => update(DEFAULT_USER_QUERY)} className="flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200">
            <RotateCcw className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </section>

      {/* Table */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-800 text-xs text-slate-400">
          <span>
            {loading ? 'Loading accounts…' : `${filtered.length} of ${users.length} account${users.length === 1 ? '' : 's'}`}
          </span>
          <label className="flex items-center gap-2">
            Rows
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-white">
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <p role="alert" className="px-5 py-10 text-center text-sm text-rose-200">{error}</p>
        ) : loading ? (
          <p className="px-5 py-12 flex items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading registered accounts…
          </p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Users className="w-8 h-8 mx-auto text-slate-600" />
            <p className="mt-3 text-sm text-slate-300">{users.length === 0 ? 'No reviewee accounts yet.' : 'No accounts match these filters.'}</p>
            <p className="text-xs text-slate-500 mt-1">{users.length === 0 ? 'Reviewees appear here when they register, or when you add one.' : 'Try clearing the filters.'}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <SortHeader label="Reviewee" sortKey="name" query={query} onSort={update} />
                    <th className="px-4 py-3 font-semibold">Course</th>
                    <SortHeader label="Registered" sortKey="enrolledAt" query={query} onSort={update} />
                    <SortHeader label="Status" sortKey="status" query={query} onSort={update} />
                    <SortHeader label="Last login" sortKey="lastLoginAt" query={query} onSort={update} />
                    <th className="px-4 py-3 font-semibold">Exams</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {paged.items.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3">
                        <button onClick={() => setSelectedId(user.id)} className="flex items-center gap-3 text-left group">
                          <Avatar name={user.name} src={user.avatar} className="w-9 h-9 border border-slate-700" />
                          <span className="min-w-0">
                            <span className="block font-semibold text-white group-hover:text-indigo-200 truncate max-w-[220px]">{user.name}</span>
                            <span className="block text-[11px] text-slate-400 truncate max-w-[220px]">{user.email}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{user.course ?? <span className="text-slate-500">{user.course === null ? 'Removed' : '—'}</span>}</td>
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{formatDate(user.enrolledAt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={statusOf(user)} />
                      </td>
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{formatRelative(user.lastLoginAt, now)}</td>
                      <td className="px-4 py-3 text-slate-300 tabular-nums">
                        {resultCounts.get(user.id)?.count ?? 0}
                        {resultCounts.get(user.id) && <span className="text-slate-500"> · avg {Math.round(resultCounts.get(user.id)!.total / resultCounts.get(user.id)!.count)}%</span>}
                      </td>
                      <td className="px-4 py-3">
                        <RowActions user={user} onOpen={() => setSelectedId(user.id)} onDialog={setDialog} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="md:hidden divide-y divide-slate-800">
              {paged.items.map((user) => (
                <li key={user.id} className="p-4 space-y-3">
                  <button onClick={() => setSelectedId(user.id)} className="flex items-center gap-3 text-left w-full">
                    <Avatar name={user.name} src={user.avatar} className="w-10 h-10 border border-slate-700" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-white truncate">{user.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{user.email}</span>
                    </span>
                    <StatusBadge status={statusOf(user)} />
                  </button>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    <span>Course: <strong className="text-slate-200">{user.course ?? 'none'}</strong></span>
                    <span>Registered {formatDate(user.enrolledAt)}</span>
                    <span>Last login {formatRelative(user.lastLoginAt, now)}</span>
                  </div>
                  <RowActions user={user} onOpen={() => setSelectedId(user.id)} onDialog={setDialog} />
                </li>
              ))}
            </ul>

            {/* Pagination */}
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-slate-800 text-xs text-slate-400">
              <span>
                Page {paged.page} of {paged.pages}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setPage(paged.page - 1)} disabled={paged.page <= 1} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-40">
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <button onClick={() => setPage(paged.page + 1)} disabled={paged.page >= paged.pages} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-40">
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
      {dialogs}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const RowActions: React.FC<{ user: UserProfile; onOpen: () => void; onDialog: (d: Dialog) => void }> = ({ user, onOpen, onDialog }) => {
  const status = statusOf(user);
  const btn = 'p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition';
  return (
    <div className="flex items-center justify-start md:justify-end gap-1.5">
      <button onClick={onOpen} className={btn} title="View profile and performance" aria-label={`View ${user.name}`}>
        <Eye className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onDialog({ kind: 'edit', user })} className={btn} title="Edit" aria-label={`Edit ${user.name}`}>
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {status === 'pending' && (
        <button onClick={() => onDialog({ kind: 'status', user, status: 'active' })} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold">
          Approve
        </button>
      )}
      {status === 'suspended' && (
        <button onClick={() => onDialog({ kind: 'status', user, status: 'active' })} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold">
          Restore
        </button>
      )}
      {status === 'inactive' && (
        <button onClick={() => onDialog({ kind: 'status', user, status: 'active' })} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold">
          Activate
        </button>
      )}
      {status === 'active' && (
        <>
          <button onClick={() => onDialog({ kind: 'status', user, status: 'suspended' })} className={btn} title="Suspend" aria-label={`Suspend ${user.name}`}>
            <Ban className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDialog({ kind: 'status', user, status: 'inactive' })} className={btn} title="Deactivate" aria-label={`Deactivate ${user.name}`}>
            <PauseCircle className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      <button onClick={() => onDialog({ kind: 'delete', user })} className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-600 text-slate-300 hover:text-white transition" title="Delete permanently" aria-label={`Delete ${user.name}`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const SortHeader: React.FC<{ label: string; sortKey: SortKey; query: UserQuery; onSort: (p: Partial<UserQuery>) => void }> = ({ label, sortKey, query, onSort }) => {
  const active = query.sort === sortKey;
  return (
    <th className="px-4 py-3 font-semibold" aria-sort={active ? (query.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={() => onSort(active ? { direction: query.direction === 'asc' ? 'desc' : 'asc' } : { sort: sortKey, direction: sortKey === 'name' || sortKey === 'email' ? 'asc' : 'desc' })}
        className={`flex items-center gap-1 uppercase ${active ? 'text-indigo-300' : 'hover:text-slate-300'}`}
      >
        {label}
        {active && <span aria-hidden>{query.direction === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
};

const Select: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: [string, string][] }> = ({ label, value, onChange, options }) => (
  <label className="block flex-1 min-w-0">
    <span className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl bg-slate-950/70 border border-slate-700 px-3 py-2.5 text-sm text-white focus:border-indigo-400 outline-none">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </label>
);

const DateInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <label className="block">
    <span className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">{label}</span>
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm text-white focus:border-indigo-400 outline-none [color-scheme:dark]"
    />
  </label>
);

/** Share of accounts per status: a segmented bar with a labelled legend (never color alone). */
const StatusSplit: React.FC<{ stats: ReturnType<typeof computeUserStats> }> = ({ stats }) => {
  const parts: { key: UserStatus; color: string }[] = [
    { key: 'active', color: 'bg-emerald-400' },
    { key: 'pending', color: 'bg-amber-400' },
    { key: 'suspended', color: 'bg-rose-400' },
    { key: 'inactive', color: 'bg-slate-500' },
  ];
  const total = Math.max(1, stats.total);
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-800 gap-0.5" role="img" aria-label={parts.map((p) => `${STATUS_LABELS[p.key]} ${stats[p.key]}`).join(', ')}>
        {parts.map((p) => (stats[p.key] > 0 ? <span key={p.key} className={p.color} style={{ width: `${(stats[p.key] / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2 text-slate-300">
            <span className={`w-2 h-2 rounded-full ${p.color}`} aria-hidden />
            {STATUS_LABELS[p.key]}
            <span className="ml-auto font-semibold text-white tabular-nums">{stats[p.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
