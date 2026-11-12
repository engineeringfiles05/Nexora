/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Page addresses and who may open them. Every navigation, including an address typed into
 * the browser, goes through resolveRoute(). Hiding a page is only the first layer: the
 * data behind admin pages is protected by firestore.rules and the admin APIs by the server.
 */

import type { UserRole } from '../types/index.ts';

export type Access = 'public' | 'signed-in' | 'admin';

export const ROUTES = {
  login: { path: '/login', access: 'public' },
  register: { path: '/register', access: 'public' },
  'forgot-password': { path: '/forgot-password', access: 'public' },
  'reset-password': { path: '/reset-password', access: 'public' },

  'reviewee-dashboard': { path: '/dashboard', access: 'signed-in' },
  'pdf-quiz-generator': { path: '/question-sets', access: 'signed-in' },
  'exam-history': { path: '/history', access: 'signed-in' },
  account: { path: '/account', access: 'signed-in' },
  'active-exam': { path: '/exam', access: 'signed-in' },
  'exam-result': { path: '/results', access: 'signed-in' },

  'admin-dashboard': { path: '/admin', access: 'admin' },
  'pdf-importer': { path: '/admin/importer', access: 'admin' },
  'question-bank': { path: '/admin/question-bank', access: 'admin' },
  'pdf-sources': { path: '/admin/pdfs', access: 'admin' },
  'reviewees-roster': { path: '/admin/reviewees', access: 'admin' },
  'audit-logs': { path: '/admin/audit-logs', access: 'admin' },
} as const satisfies Record<string, { path: string; access: Access }>;

export type View = keyof typeof ROUTES;
export type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password';

export const AUTH_VIEWS: AuthView[] = ['login', 'register', 'forgot-password', 'reset-password'];

export function isView(value: string): value is View {
  return Object.prototype.hasOwnProperty.call(ROUTES, value);
}

export function isAuthView(view: View): view is AuthView {
  return (AUTH_VIEWS as string[]).includes(view);
}

export function pathForView(view: View): string {
  return ROUTES[view].path;
}

/** Firebase's own email links can be pointed at /auth/action; it is the reset page here. */
export function viewForPath(pathname: string): View | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/auth/action') return 'reset-password';
  const match = (Object.keys(ROUTES) as View[]).find((view) => ROUTES[view].path === path);
  return match ?? null;
}

export function homeFor(role: UserRole): View {
  return role === 'admin' ? 'admin-dashboard' : 'reviewee-dashboard';
}

export type SessionState = { status: 'signed-out' } | { status: 'signed-in'; role: UserRole };

export interface RouteDecision {
  view: View;
  /** Set when the requested page was refused, so the user can be told why. */
  denied?: boolean;
}

/** Decides which page a session may see for a requested page. */
export function resolveRoute(requested: View | null, session: SessionState): RouteDecision {
  if (session.status === 'signed-out') {
    if (requested && ROUTES[requested].access === 'public') return { view: requested };
    return { view: 'login' };
  }
  const home = homeFor(session.role);
  if (!requested) return { view: home };
  const access = ROUTES[requested].access;
  // A signed-in person following a reset link may still set a new password.
  if (access === 'public') return { view: requested === 'reset-password' ? requested : home };
  if (access === 'admin' && session.role !== 'admin') return { view: home, denied: true };
  return { view: requested };
}
