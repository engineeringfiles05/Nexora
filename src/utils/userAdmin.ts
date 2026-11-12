/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for the admin User Management dashboard: statistics, search, filters,
 * sorting, paging and per-reviewee performance. No I/O, so they are unit-tested directly.
 */

import type { Course, ExamResult, ExamType, UserProfile, UserStatus } from '../types/index.ts';
import { statusOf } from '../auth/accountStatus.ts';

export const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const time = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function isRecent(iso: string | undefined, now: number, days = RECENT_DAYS): boolean {
  const t = time(iso);
  return t > 0 && now - t <= days * DAY_MS && t <= now + DAY_MS;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  pending: number;
  rejected: number;
  suspended: number;
  newlyRegistered: number;
  recentlyActive: number;
  byCourse: Record<Course | 'none', number>;
}

export function computeUserStats(users: UserProfile[], now: number = Date.now()): UserStats {
  const stats: UserStats = {
    total: users.length,
    active: 0,
    inactive: 0,
    pending: 0,
    rejected: 0,
    suspended: 0,
    newlyRegistered: 0,
    recentlyActive: 0,
    byCourse: { REE: 0, RME: 0, none: 0 },
  };
  for (const user of users) {
    stats[statusOf(user)] += 1;
    if (isRecent(user.enrolledAt, now)) stats.newlyRegistered += 1;
    if (isRecent(user.lastLoginAt, now)) stats.recentlyActive += 1;
    stats.byCourse[user.course === 'REE' || user.course === 'RME' ? user.course : 'none'] += 1;
  }
  return stats;
}

/** Registrations per week, oldest first, for the last `weeks` weeks (current week last). */
export function weeklyRegistrations(users: UserProfile[], weeks = 8, now: number = Date.now()): { start: number; count: number }[] {
  const end = now;
  const buckets = Array.from({ length: weeks }, (_, i) => ({ start: end - (weeks - i) * 7 * DAY_MS, count: 0 }));
  for (const user of users) {
    const t = time(user.enrolledAt);
    if (!t || t > end) continue;
    const index = weeks - 1 - Math.floor((end - t) / (7 * DAY_MS));
    if (index >= 0) buckets[index]!.count += 1;
  }
  return buckets;
}

export type QuickFilter = 'all' | UserStatus | 'recent';
export type SortKey = 'name' | 'email' | 'enrolledAt' | 'status' | 'lastLoginAt';

export interface UserQuery {
  search: string;
  quick: QuickFilter;
  course: Course | 'none' | 'any';
  registeredFrom?: string; // YYYY-MM-DD
  registeredTo?: string; // YYYY-MM-DD, inclusive
  sort: SortKey;
  direction: 'asc' | 'desc';
}

export const DEFAULT_USER_QUERY: UserQuery = { search: '', quick: 'all', course: 'any', sort: 'enrolledAt', direction: 'desc' };

const STATUS_ORDER: Record<UserStatus, number> = { pending: 0, active: 1, rejected: 2, suspended: 3, inactive: 4 };

export function filterUsers(users: UserProfile[], q: UserQuery, now: number = Date.now()): UserProfile[] {
  const terms = q.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const from = q.registeredFrom ? Date.parse(`${q.registeredFrom}T00:00:00`) : NaN;
  const to = q.registeredTo ? Date.parse(`${q.registeredTo}T23:59:59.999`) : NaN;
  const result = users.filter((user) => {
    const status = statusOf(user);
    if (q.quick === 'recent' ? !isRecent(user.enrolledAt, now) : q.quick !== 'all' && status !== q.quick) return false;
    if (q.course !== 'any') {
      const course = user.course === 'REE' || user.course === 'RME' ? user.course : 'none';
      if (course !== q.course) return false;
    }
    const registered = time(user.enrolledAt);
    if (Number.isFinite(from) && registered < from) return false;
    if (Number.isFinite(to) && registered > to) return false;
    if (terms.length) {
      const haystack = `${user.name} ${user.email} ${user.course ?? ''} ${status} ${user.contactNumber ?? ''}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
  const sign = q.direction === 'asc' ? 1 : -1;
  const value = (user: UserProfile): string | number => {
    switch (q.sort) {
      case 'name':
        return user.name.toLowerCase();
      case 'email':
        return user.email.toLowerCase();
      case 'status':
        return STATUS_ORDER[statusOf(user)];
      case 'lastLoginAt':
        return time(user.lastLoginAt);
      default:
        return time(user.enrolledAt);
    }
  };
  return [...result].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return a.name.localeCompare(b.name);
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pages };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  pre_test: 'Pre-test',
  quiz: 'Quizzes',
  practice: 'Practice exams',
  pre_board: 'Pre-board',
  final_mock: 'Final Mock Board',
  pdf_quiz: 'PDF question sets',
};

export interface TypeSummary {
  type: ExamType;
  attempts: number;
  average: number | null;
  best: number | null;
  latest: number | null;
  passed: number;
}

export interface PerformanceSummary {
  attempts: number;
  average: number | null;
  passRate: number | null;
  byType: TypeSummary[];
  bySubject: { subjectId: string; name: string; percentage: number; attempts: number }[];
  /** Oldest first, for the progress chart. */
  timeline: { at: number; score: number; title: string; type: ExamType }[];
  /** Average of the latest three exams minus the average of the first three (null below 4 exams). */
  trend: number | null;
  weakTopics: string[];
}

const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

export function summarizePerformance(userId: string, results: ExamResult[]): PerformanceSummary {
  const mine = results.filter((r) => r.userId === userId).sort((a, b) => time(a.completedAt) - time(b.completedAt));
  const byType = (Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((type): TypeSummary => {
    const list = mine.filter((r) => r.type === type);
    const scores = list.map((r) => r.scorePercentage);
    return {
      type,
      attempts: list.length,
      average: avg(scores),
      best: scores.length ? Math.max(...scores) : null,
      latest: scores.length ? scores[scores.length - 1]! : null,
      passed: list.filter((r) => r.isPassed).length,
    };
  });
  const subjects = new Map<string, { name: string; correct: number; total: number; attempts: number }>();
  const weak = new Map<string, number>();
  for (const result of mine) {
    for (const [subjectId, s] of Object.entries(result.subjectBreakdown ?? {})) {
      const entry = subjects.get(subjectId) ?? { name: s.subjectName, correct: 0, total: 0, attempts: 0 };
      entry.correct += s.correct;
      entry.total += s.total;
      entry.attempts += 1;
      subjects.set(subjectId, entry);
    }
    for (const topic of result.weakTopics ?? []) weak.set(topic, (weak.get(topic) ?? 0) + 1);
  }
  const scores = mine.map((r) => r.scorePercentage);
  const first = avg(scores.slice(0, 3));
  const last = avg(scores.slice(-3));
  return {
    attempts: mine.length,
    average: avg(scores),
    passRate: mine.length ? Math.round((mine.filter((r) => r.isPassed).length / mine.length) * 100) : null,
    byType,
    bySubject: [...subjects.entries()].map(([subjectId, s]) => ({
      subjectId,
      name: s.name,
      attempts: s.attempts,
      percentage: s.total ? Math.round((s.correct / s.total) * 100) : 0,
    })),
    timeline: mine.map((r) => ({ at: time(r.completedAt), score: r.scorePercentage, title: r.title, type: r.type })),
    trend: mine.length >= 4 && first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null,
    weakTopics: [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic]) => topic),
  };
}
