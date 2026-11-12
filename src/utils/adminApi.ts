/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Calls to the admin account API (server/adminUsers.ts), authorised by the admin's ID token. */

import { auth } from '../firebase.ts';

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new AdminApiError('Sign in as the administrator first.', 401);
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new AdminApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (!isJson && res.status === 404) throw new AdminApiError('The account API is not available on this deployment.', 404, 'API_UNAVAILABLE');
    throw new AdminApiError(data?.error || `The server refused the request (HTTP ${res.status}).`, res.status, data?.code);
  }
  return data as T;
}

/** Whether the server can make Firebase Auth changes (email, sign-in block, deletion). */
export async function getAdminCapabilities(): Promise<{ serviceAccount: boolean; reachable: boolean }> {
  try {
    const data = await request<{ serviceAccount: boolean }>('GET', '/capabilities');
    return { serviceAccount: data.serviceAccount === true, reachable: true };
  } catch {
    return { serviceAccount: false, reachable: false };
  }
}

export function setSignInEmail(uid: string, email: string) {
  return request<{ ok: true }>('PATCH', `/users/${encodeURIComponent(uid)}`, { email });
}

export function setSignInBlocked(uid: string, disabled: boolean) {
  return request<{ ok: true }>('PATCH', `/users/${encodeURIComponent(uid)}`, { disabled });
}

export function deleteAuthAccount(uid: string) {
  return request<{ ok: true; existed: boolean }>('DELETE', `/users/${encodeURIComponent(uid)}`);
}
