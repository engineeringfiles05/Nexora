/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Ban, CheckCircle2, Hourglass, PauseCircle } from 'lucide-react';
import type { UserStatus } from '../../types/index.ts';
import { STATUS_LABELS } from '../../auth/accountStatus.ts';

const STATUS_STYLE: Record<UserStatus, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
  active: { className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200', icon: CheckCircle2 },
  inactive: { className: 'bg-slate-700/40 border-slate-600 text-slate-300', icon: PauseCircle },
  suspended: { className: 'bg-rose-500/10 border-rose-500/40 text-rose-200', icon: Ban },
  pending: { className: 'bg-amber-500/10 border-amber-500/40 text-amber-200', icon: Hourglass },
};

/** Status always shows an icon and a label, never color alone. */
export const StatusBadge: React.FC<{ status: UserStatus }> = ({ status }) => {
  const { className, icon: Icon } = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${className}`}>
      <Icon className="w-3 h-3" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
};

export function formatDate(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function formatDateTime(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** "3 h ago", "2 d ago" for recent times, otherwise the date. */
export function formatRelative(iso: string | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'Never';
  const minutes = Math.round((now - t) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return formatDate(iso);
}
