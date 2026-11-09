/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Signed-in (account) data versus signed-out (demo) data.
 *
 * Demo mode keeps its sample data in this browser (utils/persistence.ts). A signed-in account
 * never reads or writes that cache: its data lives only in memory, comes from Firestore
 * queries that match the security rules for its role, and is cleared whenever the account
 * changes. An empty query result means "no records", not "keep what was there before".
 */

import type { AuditLog, ExamResult, PdfSource, Question, UserProfile, UserRole } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type CloudCollection = 'questions' | 'pdfSources' | 'examResults' | 'auditLogs' | 'users';
export type QueryFilter = { field: string; value: string | boolean };

/**
 * What each role may list, mirroring firestore.rules. A list query is only allowed when its
 * filters guarantee every returned document passes the rule, so reviewees must filter.
 * A collection missing from the plan is not queried at all (reviewees: users, auditLogs).
 * `null` means the whole collection.
 */
export function cloudQueryPlan(role: UserRole, uid: string): Partial<Record<CloudCollection, QueryFilter | null>> {
  if (role === 'admin') return { questions: null, pdfSources: null, examResults: null, auditLogs: null, users: null };
  return {
    questions: { field: 'isPublished', value: true },
    pdfSources: { field: 'isPublicToReviewees', value: true },
    examResults: { field: 'userId', value: uid },
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

export function describeSyncError(collection: CloudCollection | 'write', error: unknown): string {
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
    return collection === 'write'
      ? 'Your account is not allowed to save that change, so it was not saved to the cloud.'
      : `Your account is not allowed to load ${what}. Ask an administrator to check your access.`;
  }
  return collection === 'write' ? 'The last change could not be saved to the cloud.' : `Could not load ${what} from the cloud. Check your connection and try again.`;
}

// ---------------------------------------------------------------------------
// Identity rules
// ---------------------------------------------------------------------------

/** Demo role switching only exists signed out; a signed-in identity is never replaced. */
export function canSwitchDemoRole(signedIn: boolean): boolean {
  return !signedIn;
}

/** Reviewees only ever see their own results; administrators see everyone's. */
export function visibleResults(user: Pick<UserProfile, 'id' | 'role'>, results: ExamResult[]): ExamResult[] {
  return user.role === 'admin' ? results : results.filter((r) => r.userId === user.id);
}
