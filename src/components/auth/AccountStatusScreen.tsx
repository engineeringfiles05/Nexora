/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The only page an account that isn't approved can see (pending, rejected, suspended or
 * deactivated). The app shows it for every address (auth/routes.ts) and firestore.rules
 * refuses such accounts all review material, so it can't be bypassed. The profile is watched
 * live: once the administrator approves the account, the app opens the dashboard by itself.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Ban, CalendarDays, Hourglass, Loader2, LogOut, Mail, PauseCircle, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import type { UserProfile, UserStatus } from '../../types/index.ts';
import { STATUS_LABELS, statusOf } from '../../auth/accountStatus.ts';
import { Backdrop, Logo } from './AuthPage.tsx';
import { Notice } from './AuthFields.tsx';

interface Props {
  profile: UserProfile;
  onLogout: () => void;
  /** Reads the account again; resolves to true when the status changed. */
  onCheckStatus: () => Promise<boolean>;
}

const COPY: Record<Exclude<UserStatus, 'active'>, { title: string; body: string; restriction: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  pending: {
    title: 'Your Account Is Pending Approval!',
    body: 'Thank you for registering with NEXORA Academy. Your account has been successfully created and is currently awaiting verification and approval from our administrator. You will be able to access the platform once your account has been approved.',
    restriction:
      'Access to the dashboard, review materials, question banks and examinations is temporarily restricted until your account is approved. This page updates by itself as soon as it is.',
    icon: Hourglass,
    tone: 'amber',
  },
  rejected: {
    title: 'Your Registration Was Not Approved',
    body: 'The NEXORA Academy administrator reviewed your registration and did not approve it.',
    restriction: 'You can’t access the platform with this account. Contact NEXORA Academy if you think this is a mistake.',
    icon: XCircle,
    tone: 'rose',
  },
  suspended: {
    title: 'Your Account Is Suspended',
    body: 'The NEXORA Academy administrator has temporarily suspended your account. Your examination history and progress are kept.',
    restriction: 'Access is temporarily disabled. This page updates by itself when your account is reactivated.',
    icon: Ban,
    tone: 'rose',
  },
  inactive: {
    title: 'Your Account Is Deactivated',
    body: 'The NEXORA Academy administrator has deactivated your account. Your examination history and progress are kept.',
    restriction: 'Contact NEXORA Academy to have your account reactivated.',
    icon: PauseCircle,
    tone: 'slate',
  },
};

const TONES: Record<string, { ring: string; icon: string; badge: string }> = {
  amber: { ring: 'bg-amber-500/10 border-amber-500/30', icon: 'text-amber-300', badge: 'bg-amber-500/10 border-amber-500/40 text-amber-200' },
  rose: { ring: 'bg-rose-500/10 border-rose-500/30', icon: 'text-rose-300', badge: 'bg-rose-500/10 border-rose-500/40 text-rose-200' },
  slate: { ring: 'bg-slate-700/30 border-slate-600', icon: 'text-slate-300', badge: 'bg-slate-700/40 border-slate-600 text-slate-200' },
};

export function formatRegistered(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

export const AccountStatusScreen: React.FC<Props> = ({ profile, onLogout, onCheckStatus }) => {
  const status = statusOf(profile);
  const copy = COPY[status === 'active' ? 'pending' : status];
  const tone = TONES[copy.tone]!;
  const Icon = copy.icon;
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setChecked(null);
    try {
      const changed = await onCheckStatus();
      if (!changed) setChecked(`Checked just now: your account is still ${STATUS_LABELS[status].toLowerCase()}.`);
    } catch {
      setChecked('Could not check right now. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <Backdrop />
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-6">
          <Logo size="sm" />
        </div>
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[560px] rounded-3xl bg-slate-900/85 backdrop-blur-xl border border-slate-800 shadow-2xl shadow-black/40 p-6 sm:p-9"
          aria-labelledby="account-status-title"
        >
          <div className="flex flex-col items-center text-center">
            <span className={`relative w-16 h-16 rounded-2xl border flex items-center justify-center ${tone.ring}`}>
              <Icon className={`w-8 h-8 ${tone.icon}`} />
              {status === 'pending' && <span className="absolute -inset-1.5 rounded-[20px] border-2 border-amber-400/30 animate-pulse" aria-hidden />}
            </span>
            <span className={`mt-5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${tone.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'pending' ? 'bg-amber-300 animate-pulse' : 'bg-current'}`} aria-hidden />
              Status: {STATUS_LABELS[status]}
            </span>
            <h1 id="account-status-title" className="mt-4 text-2xl sm:text-[28px] font-extrabold tracking-tight text-white">
              {copy.title}
            </h1>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">{copy.body}</p>
          </div>

          <dl className="mt-6 grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-4 py-3 flex items-start gap-3">
              <Mail className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <dt className="text-[11px] text-slate-500">Account</dt>
                <dd className="text-slate-100 truncate">{profile.email}</dd>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-4 py-3 flex items-start gap-3">
              <CalendarDays className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[11px] text-slate-500">Registered</dt>
                <dd className="text-slate-100">{formatRegistered(profile.enrolledAt)}</dd>
              </div>
            </div>
          </dl>

          {profile.statusReason && status !== 'pending' && (
            <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
              <span className="text-slate-500">Reason given: </span>
              {profile.statusReason}
            </p>
          )}

          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-indigo-800/60 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-100">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <p className="leading-relaxed">{copy.restriction}</p>
          </div>

          {checked && (
            <div className="mt-4">
              <Notice tone="info">{checked}</Notice>
            </div>
          )}

          <div className="mt-6 grid sm:grid-cols-2 gap-3">
            {status !== 'rejected' && (
              <button
                onClick={check}
                disabled={checking}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-sm font-bold shadow-lg shadow-indigo-900/40 disabled:opacity-60"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {checking ? 'Checking…' : 'Check approval status'}
              </button>
            )}
            <button
              onClick={onLogout}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold ${status === 'rejected' ? 'sm:col-span-2' : ''}`}
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </motion.section>
        <p className="mt-6 text-[11px] text-slate-500 text-center max-w-md">Questions about your account? Contact NEXORA Academy and mention the email address above.</p>
      </main>
    </div>
  );
};
