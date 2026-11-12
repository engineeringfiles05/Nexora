/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The signed-in account's data. Every page except the sign-in pages requires an account
 * (auth/routes.ts). Account data lives only in memory, comes from Firestore queries that
 * match the security rules for its role, and is cleared whenever the account changes. An
 * empty query result means "no records", not "keep what was there before".
 */

import type { AuditLog, Course, ExamResult, PdfSource, Question, UserProfile, UserRole } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type CloudCollection = 'questions' | 'pdfSources' | 'examResults' | 'auditLogs' | 'users';
export type QueryFilter = { field: string; value: string | boolean };
export type QueryFilters = QueryFilter[];

/**
 * What each role may list, mirroring firestore.rules. A list query is only allowed when its
 * filters guarantee every returned document passes the rule, so reviewees must filter: by
 * publication and by their own course. A collection missing from the plan is not queried at
 * all (reviewees: users, auditLogs; reviewees without a course: questions, pdfSources).
 * `null` means the whole collection.
 */
export function cloudQueryPlan(role: UserRole, uid: string, course?: Course | null): Partial<Record<CloudCollection, QueryFilters | null>> {
  if (role === 'admin') return { questions: null, pdfSources: null, examResults: null, auditLogs: null, users: null };
  const own = { examResults: [{ field: 'userId', value: uid }] };
  if (course !== 'REE' && course !== 'RME') return own;
  return {
    questions: [
      { field: 'isPublished', value: true },
      { field: 'course', value: course },
    ],
    pdfSources: [
      { field: 'isPublicToReviewees', value: true },
      { field: 'course', value: course },
    ],
    ...own,
  };
}

/** Newest first. Log ids are "log-<epoch ms>-<random>"; the stored time has no date. */
export function sortAuditLogs(logs: AuditLog[]): AuditLog[] {
  const stamp = (id: string) => Number(/^log-(\d+)/.exec(id)?.[1] ?? 0);
  return [...logs].sort((a, b) => stamp(b.id) - stamp(a.id));
}

// ---------------------------------------------------------------------------
// Cloud state
// ---------------------------------------------------------------------------

export interface CloudState {
  /** The account this data belongs to. Data for any other uid is discarded. */
  uid: string | null;
  questions: Question[] | null; // null while the first snapshot is loading
  pdfSources: PdfSource[] | null;
  examResults: ExamResult[] | null;
  /** Admins only; stays null (never queried) for reviewees. */
  auditLogs: AuditLog[] | null;
  /** Registered accounts, admins only; stays null (never queried) for reviewees. */
  users: UserProfile[] | null;
  errors: Partial<Record<CloudCollection | 'write', string>>;
}

export type CloudAction =
  | { type: 'reset'; uid: string | null }
  | { type: 'snapshot'; uid: string; collection: CloudCollection; docs: unknown[] }
  | { type: 'error'; uid: string; collection: CloudCollection | 'write'; message: string }
  | { type: 'local'; uid: string; collection: CloudCollection; update: (prev: any[]) => any[] }
  | { type: 'dismiss'; uid: string; key: CloudCollection | 'write' };

export const emptyCloudState = (uid: string | null = null): CloudState => ({
  uid,
  questions: null,
  pdfSources: null,
  examResults: null,
  auditLogs: null,
  users: null,
  errors: {},
});

export function cloudReducer(state: CloudState, action: CloudAction): CloudState {
  if (action.type === 'reset') return emptyCloudState(action.uid);
  // A late callback from the previous account must not leak into this one.
  if (action.uid !== state.uid) return state;
  switch (action.type) {
    case 'snapshot': {
      const { [action.collection]: _cleared, ...errors } = state.errors;
      return { ...state, [action.collection]: action.docs, errors };
    }
    case 'error':
      return { ...state, errors: { ...state.errors, [action.collection]: action.message } };
    case 'local':
      return { ...state, [action.collection]: action.update(state[action.collection] ?? []) };
    case 'dismiss': {
      const { [action.key]: _dismissed, ...errors } = state.errors;
      return { ...state, errors };
    }
  }
}

/**
 * The administrator is allowed everything by firestore.rules, so a refusal for them means the
 * rules published in Firebase are not the ones in this repository (an older copy was published,
 * for example by Google AI Studio). Say that, instead of "ask an administrator".
 */
export const OUTDATED_RULES_HELP =
  'The security rules published in Firebase are out of date, so Firebase refused your administrator account. Publish the current firestore.rules again (npm run deploy:rules, or paste it into Firebase Console \u2192 Firestore Database \u2192 your app\u2019s database \u2192 Rules), then refresh.';

export function describeSyncError(collection: CloudCollection | 'write', error: unknown, role: UserRole = 'reviewee'): string {
  const code = (error as { code?: string })?.code ?? '';
  const what = {
    questions: 'questions',
    pdfSources: 'question sets',
    examResults: 'exam history',
    auditLogs: 'the audit log',
    users: 'registered reviewees',
    write: 'your last change',
  }[collection];
  if (code === 'permission-denied' || /insufficient permissions/i.test(String((error as Error)?.message))) {
    if (role === 'admin') {
      return collection === 'write' ? `Your last change was not saved. ${OUTDATED_RULES_HELP}` : `Could not load ${what}. ${OUTDATED_RULES_HELP}`;
    }
    return collection === 'write'
      ? 'Your account is not allowed to save that change, so it was not saved to the cloud.'
      : `Your account is not allowed to load ${what}. Ask an administrator to check your access.`;
  }
  return collection === 'write' ? 'The last change could not be saved to the cloud.' : `Could not load ${what} from the cloud. Check your connection and try again.`;
}

// ---------------------------------------------------------------------------
// Identity rules
// ---------------------------------------------------------------------------

/** Reviewees only ever see their own results; administrators see everyone's. */
export function visibleResults(user: Pick<UserProfile, 'id' | 'role'>, results: ExamResult[]): ExamResult[] {
  return user.role === 'admin' ? results : results.filter((r) => r.userId === user.id);
}
