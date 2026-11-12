/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Firebase Authentication administration (change a sign-in email, block or allow sign-in,
 * delete an account) through Google's Identity Toolkit API, authorised by a service account.
 * This is what the Firebase Admin SDK does; it is done directly to avoid a large dependency.
 *
 * Configure with FIREBASE_SERVICE_ACCOUNT: the service account key JSON from Firebase Console
 * → Project settings → Service accounts → Generate new private key (raw JSON or base64).
 * It is a powerful secret: keep it only in the server's environment variables.
 */

import { createSign } from 'node:crypto';

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

export function readServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text);
    if (typeof json.client_email !== 'string' || typeof json.private_key !== 'string') return null;
    return { clientEmail: json.client_email, privateKey: json.private_key.replace(/\\n/g, '\n'), projectId: json.project_id };
  } catch {
    return null;
  }
}

export class AuthAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

const SCOPES = 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface AuthAdmin {
  updateUser(uid: string, changes: { email?: string; disabled?: boolean }): Promise<void>;
  deleteUser(uid: string): Promise<{ existed: boolean }>;
}

export function createAuthAdmin(options: { account: ServiceAccount; projectId: string; fetcher?: typeof fetch; now?: () => number }): AuthAdmin {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const iat = Math.floor(now() / 1000);
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: options.account.clientEmail, scope: SCOPES, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(options.account.privateKey).toString('base64url');
    const res = await fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !data.access_token) throw new AuthAdminError('The server could not authenticate with Google using its service account.', 'SERVICE_ACCOUNT_REJECTED', 502);
    token = { value: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call(method: 'accounts:update' | 'accounts:delete', body: Record<string, unknown>) {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/${method}`;
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const code = String(data.error?.message ?? `HTTP_${res.status}`).split(/[\s:]/)[0]!;
    if (code === 'USER_NOT_FOUND') throw new AuthAdminError('This account no longer exists.', code, 404);
    if (code === 'EMAIL_EXISTS') throw new AuthAdminError('Another account already uses this email address.', code, 409);
    if (code === 'INVALID_EMAIL') throw new AuthAdminError('That email address is not valid.', code, 400);
    throw new AuthAdminError('Firebase Authentication refused the change.', code, 502);
  }

  return {
    async updateUser(uid, changes) {
      const body: Record<string, unknown> = { localId: uid };
      if (changes.email) {
        body.email = changes.email;
        body.emailVerified = false; // the new address hasn't been confirmed by its owner
      }
      if (typeof changes.disabled === 'boolean') {
        body.disableUser = changes.disabled;
        // Blocking also ends the account's existing sessions.
        if (changes.disabled) body.validSince = String(Math.floor(now() / 1000));
      }
      await call('accounts:update', body);
    },
    async deleteUser(uid) {
      try {
        await call('accounts:delete', { localId: uid });
        return { existed: true };
      } catch (error) {
        if (error instanceof AuthAdminError && error.code === 'USER_NOT_FOUND') return { existed: false };
        throw error;
      }
    },
  };
}
