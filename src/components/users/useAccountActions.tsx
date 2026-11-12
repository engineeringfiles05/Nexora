/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Approve, reject, suspend, deactivate and reactivate accounts, with a confirmation dialog,
 * a result notice and an activity-log entry. Shared by User Management, User Approvals and
 * the dashboard's registration notifications, so every entry point behaves the same.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { UserProfile, UserStatus } from '../../types/index.ts';
import { STATUS_LABELS, statusOf } from '../../auth/accountStatus.ts';
import { describeAuthError } from '../../auth/validation.ts';
import { setAccountStatus } from '../../auth/adminUsers.ts';
import { AdminApiError, getAdminCapabilities, setSignInBlocked } from '../../utils/adminApi.ts';
import { StatusModal } from './UserModals.tsx';

export type UserLogEntry = { action: string; details: string; badge?: string; target?: Pick<UserProfile, 'id' | 'name' | 'email'> };
export type NoticeState = { tone: 'success' | 'error' | 'info'; text: string } | null;

export function errorText(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'permission-denied') return 'Firebase refused the change: the published Firestore rules are out of date. Run npm run deploy:rules and try again.';
  if (code.startsWith('auth/')) return describeAuthError(error);
  return 'The change could not be saved. Check your connection and try again.';
}

/** The activity-log name of a status change. */
export function statusAction(before: UserStatus, after: UserStatus): string {
  if (after === 'active') return before === 'pending' || before === 'rejected' ? 'Account Approved' : 'Account Reactivated';
  return { pending: 'Account Set to Pending', rejected: 'Account Rejected', suspended: 'Account Suspended', inactive: 'Account Deactivated' }[after];
}

export function useAccountActions(onLog: (entry: UserLogEntry) => void) {
  const [serviceAccount, setServiceAccount] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [request, setRequest] = useState<{ user: UserProfile; status: UserStatus } | null>(null);

  useEffect(() => {
    getAdminCapabilities().then((c) => setServiceAccount(c.serviceAccount));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === 'error' ? 12_000 : 7_000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Firestore first: the profile status is what firestore.rules and the app enforce, and the
   * person's open session reacts to it at once. A deactivated account is also blocked from
   * signing in at Firebase Authentication when the server has Admin credentials; other
   * statuses can still sign in, to see their account status page.
   */
  const applyStatus = async (user: UserProfile, status: UserStatus, reason = ''): Promise<string | null> => {
    const before = statusOf(user);
    try {
      await setAccountStatus(user.id, status, reason);
    } catch (err) {
      return errorText(err);
    }
    let authNote = '';
    if (serviceAccount && (status === 'inactive' || before === 'inactive')) {
      try {
        await setSignInBlocked(user.id, status === 'inactive');
      } catch (err) {
        authNote = ` The status is saved and enforced, but updating sign-in at Firebase Authentication failed: ${errorText(err)}`;
      }
    }
    const action = statusAction(before, status);
    onLog({
      action,
      details: `${user.name} (${user.email}): ${STATUS_LABELS[before]} → ${STATUS_LABELS[status]}.${reason.trim() && status !== 'active' ? ` Reason: ${reason.trim()}` : ''}`,
      badge: 'Users',
      target: user,
    });
    setNotice({ tone: authNote ? 'info' : 'success', text: `${action}: ${user.name}.${authNote}` });
    return null;
  };

  const elements = (
    <>
      {request && (
        <StatusModal
          user={request.user}
          status={request.status}
          onClose={() => setRequest(null)}
          onConfirm={async (reason) => {
            const err = await applyStatus(request.user, request.status, reason);
            if (!err) setRequest(null);
            return err;
          }}
        />
      )}
      <NoticeToast notice={notice} onDismiss={() => setNotice(null)} />
    </>
  );

  return {
    serviceAccount,
    notice,
    setNotice,
    applyStatus,
    /** Opens the confirmation dialog for a status change. */
    requestStatus: (user: UserProfile, status: UserStatus) => setRequest({ user, status }),
    elements,
  };
}

export const NoticeToast: React.FC<{ notice: NoticeState; onDismiss: () => void }> = ({ notice, onDismiss }) =>
  notice ? (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md rounded-2xl border px-4 py-3 shadow-2xl text-sm flex items-start gap-3 bg-slate-900/95 backdrop-blur ${
        notice.tone === 'error' ? 'border-rose-700/60 text-rose-100' : notice.tone === 'info' ? 'border-amber-700/60 text-amber-100' : 'border-emerald-700/60 text-slate-100'
      }`}
    >
      <span className="flex-1 leading-relaxed">{notice.text}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-slate-400 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;
