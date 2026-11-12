/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The admin account API: only the verified administrator may call it, never on their own
 * account, and it really reaches Firebase Authentication (checked with a fake Google API).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createApp } from './app.ts';
import { createAuthAdmin, readServiceAccount, type AuthAdmin } from './googleAdmin.ts';
import { ADMIN_EMAIL, FIREBASE_PROJECT_ID } from '../src/auth/roles.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificates = async () => ({ k: publicKey.export({ type: 'spki', format: 'pem' }).toString() });
const now = Math.floor(Date.now() / 1000);

function idToken(claims: Record<string, unknown>) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid: 'k' })}.${encode({
    aud: FIREBASE_PROJECT_ID,
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    iat: now - 5,
    exp: now + 3600,
    auth_time: now - 5,
    ...claims,
  })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url')}`;
}

const ADMIN = idToken({ sub: 'owner-uid', email: ADMIN_EMAIL, email_verified: true });
const REVIEWEE = idToken({ sub: 'rev-uid', email: 'rev@example.com', email_verified: true });

async function serve(authAdmin: AuthAdmin | null) {
  const app = createApp({ GEMINI_API_KEY: '', NODE_ENV: 'production', NEXORA_ADMIN_TOKEN: 'shared-secret' }, { certificates, authAdmin });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const call = (url: string, method: string, token?: string, body?: unknown, extra: Record<string, string> = {}) =>
  fetch(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

function recordingAdmin() {
  const calls: unknown[][] = [];
  const admin: AuthAdmin = {
    updateUser: async (...args) => void calls.push(['update', ...args]),
    deleteUser: async (uid) => {
      calls.push(['delete', uid]);
      return { existed: true };
    },
  };
  return { admin, calls };
}

test('unauthorized requests are refused: no sign-in, the shared AI token, a reviewee, a forged token', async () => {
  const { admin, calls } = recordingAdmin();
  const { base, close } = await serve(admin);
  try {
    for (const [method, path, body] of [
      ['GET', '/capabilities'],
      ['PATCH', '/users/victim', { disabled: true }],
      ['DELETE', '/users/victim'],
    ] as const) {
      assert.equal((await call(base + path, method, undefined, body)).status, 401, `${method} ${path} without sign-in`);
      assert.equal((await call(base + path, method, undefined, body, { 'x-nexora-admin-token': 'shared-secret' })).status, 401, 'shared token is not enough');
      assert.equal((await call(base + path, method, REVIEWEE, body)).status, 403, `${method} ${path} as reviewee`);
      assert.equal((await call(base + path, method, `${ADMIN.slice(0, -4)}AAAA`, body)).status, 401, 'tampered admin token');
    }
    assert.equal(calls.length, 0, 'nothing reached Firebase Authentication');
  } finally {
    await close();
  }
});

test('the administrator changes and deletes reviewee accounts, never their own', async () => {
  const { admin, calls } = recordingAdmin();
  const { base, close } = await serve(admin);
  try {
    assert.deepEqual(await (await call(`${base}/capabilities`, 'GET', ADMIN)).json(), { serviceAccount: true });
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, { disabled: true })).status, 200);
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, { email: ' New@Example.com ' })).status, 200);
    assert.equal((await call(`${base}/users/rev-uid`, 'DELETE', ADMIN)).status, 200);
    assert.deepEqual(calls, [
      ['update', 'rev-uid', { disabled: true }],
      ['update', 'rev-uid', { email: 'new@example.com' }],
      ['delete', 'rev-uid'],
    ]);

    // Own account, bad input and reserved addresses are refused before reaching Firebase.
    assert.equal((await call(`${base}/users/owner-uid`, 'DELETE', ADMIN)).status, 400);
    assert.equal((await call(`${base}/users/owner-uid`, 'PATCH', ADMIN, { disabled: true })).status, 400);
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, { email: 'not-an-email' })).status, 400);
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, { email: ADMIN_EMAIL })).status, 400);
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, { disabled: 'yes' })).status, 400);
    assert.equal((await call(`${base}/users/rev-uid`, 'PATCH', ADMIN, {})).status, 400);
    assert.equal((await call(`${base}/users/..%2Fx`, 'DELETE', ADMIN)).status, 400);
    assert.equal(calls.length, 3);
  } finally {
    await close();
  }
});

test('without a service account the routes say exactly what is missing', async () => {
  const { base, close } = await serve(null);
  try {
    assert.deepEqual(await (await call(`${base}/capabilities`, 'GET', ADMIN)).json(), { serviceAccount: false });
    const res = await call(`${base}/users/rev-uid`, 'DELETE', ADMIN);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'SERVICE_ACCOUNT_MISSING');
    assert.equal((await call(`${base}/users/rev-uid`, 'DELETE', REVIEWEE)).status, 403); // still checked first
  } finally {
    await close();
  }
});

test('Google Identity Toolkit calls: service-account token, disable with session revocation, delete', async () => {
  const sa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = JSON.stringify({ client_email: 'svc@proj.iam.gserviceaccount.com', private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'proj' });
  const account = readServiceAccount(Buffer.from(key).toString('base64'));
  assert.ok(account);
  assert.equal(readServiceAccount('{"nope":1}'), null);
  const requests: { url: string; body: string; auth?: string }[] = [];
  let missing = false;
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization });
    if (url.includes('oauth2')) return Response.json({ access_token: 'ya29.token', expires_in: 3600 });
    if (missing) return Response.json({ error: { message: 'USER_NOT_FOUND' } }, { status: 400 });
    return Response.json({});
  }) as unknown as typeof fetch;
  const admin = createAuthAdmin({ account: account!, projectId: 'proj', fetcher, now: () => 1_800_000_000_000 });
  await admin.updateUser('u1', { disabled: true });
  await admin.updateUser('u1', { email: 'x@example.com' });
  missing = true;
  assert.deepEqual(await admin.deleteUser('gone'), { existed: false });

  assert.equal(requests.filter((r) => r.url.includes('oauth2')).length, 1, 'token reused');
  const assertion = new URLSearchParams(requests[0]!.body).get('assertion')!;
  const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());
  assert.equal(claims.iss, 'svc@proj.iam.gserviceaccount.com');
  assert.equal(requests[1]!.url, 'https://identitytoolkit.googleapis.com/v1/projects/proj/accounts:update');
  assert.equal(requests[1]!.auth, 'Bearer ya29.token');
  assert.deepEqual(JSON.parse(requests[1]!.body), { localId: 'u1', disableUser: true, validSince: '1800000000' });
  assert.deepEqual(JSON.parse(requests[2]!.body), { localId: 'u1', email: 'x@example.com', emailVerified: false });
  assert.match(requests[3]!.url, /accounts:delete$/);
});
