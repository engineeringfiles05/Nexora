/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The board exam date comes from one setting, VITE_REE_EXAM_DATE (YYYY-MM-DD). Nothing is
 * assumed: without that setting the app says the date is not set, and after the date it
 * says so instead of counting down.
 */

export type ExamCountdown =
  | { state: 'unconfigured' }
  | { state: 'invalid'; raw: string }
  | { state: 'upcoming'; date: Date; days: number }
  | { state: 'today'; date: Date }
  | { state: 'past'; date: Date; days: number };

export function configuredExamDate(): string | undefined {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_REE_EXAM_DATE?.trim();
  return value || undefined;
}

/** Parses YYYY-MM-DD as a calendar date, rejecting impossible dates such as 2026-02-30. */
export function parseExamDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Whole calendar days between today and the exam, in the viewer's local time. */
export function getExamCountdown(raw: string | undefined, now: Date = new Date()): ExamCountdown {
  if (!raw) return { state: 'unconfigured' };
  const date = parseExamDate(raw);
  if (!date) return { state: 'invalid', raw };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return { state: 'upcoming', date, days };
  if (days === 0) return { state: 'today', date };
  return { state: 'past', date, days: -days };
}

export function formatExamDate(date: Date): string {
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function countdownLabel(c: ExamCountdown): string {
  switch (c.state) {
    case 'unconfigured':
      return 'Exam date not set';
    case 'invalid':
      return 'Exam date setting is invalid';
    case 'upcoming':
      return `${c.days} ${c.days === 1 ? 'day' : 'days'} remaining`;
    case 'today':
      return 'Exam is today';
    case 'past':
      return `Exam date passed (${formatExamDate(c.date)})`;
  }
}
