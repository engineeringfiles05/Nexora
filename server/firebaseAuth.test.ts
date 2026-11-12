/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side authorization: Firebase ID tokens are verified (signature, project, expiry)
 * and only the verified administrator may use the admin APIs. Tokens are signed here with a
 * throwaway key pair that the app is told to trust, the same way Google's keys are used.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createApp } from './app.ts';
import { verifyIdToken, IdTokenError, googleCertificates } from './firebaseAuth.ts';
import { ADMIN_EMAIL, FIREBASE_PROJECT_ID } from '../src/auth/roles.ts';
import firebaseConfig from '../firebase-applet-config.json';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key';
const certificates = async () => ({ [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() });
const now = Math.floor(Date.now() / 1000);

function sign(claims: Record<string, unknown>, options: { key?: typeof privateKey; kid?: string; alg?: string } = {}) {
  const header = { alg: options.alg ?? 'RS256', kid: options.kid ?? KID, typ: 'JWT' };
  const payload = {
    aud: FIREBASE_PROJECT_ID,
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    sub: 'uid-123',
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
    ...claims,
  };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256').update(body).sign(options.key ?? privateKey).toString('base64url');
  return `${body}.${signature}`;
}

const adminToken = sign({ email: ADMIN_EMAIL, email_verified: true, sub: 'owner' });
const revieweeToken = sign({ email: 'reviewee@example.com', email_verified: true });

test('the shared project id matches the Firebase web config', () => {
  assert.equal(FIREBASE_PROJECT_ID, firebaseConfig.projectId);
});

test('a valid token is verified and given the role its identity has', async () => {
  const admin = await verifyIdToken(adminToken, { certificates });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.uid, 'owner');
  const reviewee = await verifyIdToken(revieweeToken, { certificates });
  assert.equal(reviewee.role, 'reviewee');
});

test('the owner address is not an administrator until Firebase has verified it', async () => {
  const unverified = await verifyIdToken(sign({ email: ADMIN_EMAIL, email_verified: false }), { certificates });
  assert.equal(unverified.role, 'reviewee');
});

test('forged, expired, foreign and malformed tokens are rejected', async () => {
  const bad = [
    sign({ email: ADMIN_EMAIL, email_verified: true }, { key: other.privateKey }), // wrong signer
    sign({ email: ADMIN_EMAIL, email_verified: true, exp: now - 3600 }), // expired
    sign({ email: ADMIN_EMAIL, email_verified: true, aud: 'another-project' }),
    sign({ email: ADMIN_EMAIL, email_verified: true, iss: 'https://evil.example' }),
    sign({ email: ADMIN_EMAIL, email_verified: true, sub: '' }),
    sign({ email: ADMIN_EMAIL, email_verified: true }, { kid: 'unknown' }),
    sign({ email: ADMIN_EMAIL, email_verified: true }, { alg: 'none' }),
    'not-a-token',
    // Changing the claims after signing breaks the signature.
    (() => {
      const [h, , s] = revieweeToken.split('.');
      const p = Buffer.from(JSON.stringify({ aud: FIREBASE_PROJECT_ID, iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`, sub: 'x', iat: now, exp: now + 60, auth_time: now, email: ADMIN_EMAIL, email_verified: true })).toString('base64url');
      return `${h}.${p}.${s}`;
    })(),
  ];
  for (const token of bad) await assert.rejects(verifyIdToken(token, { certificates }), IdTokenError);
});

test('Google certificates are cached for their max-age', async () => {
  let calls = 0;
  let clock = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify({ k: 'pem' }), { headers: { 'cache-control': 'public, max-age=100' } });
  }) as unknown as typeof fetch;
  const source = googleCertificates(fetcher, () => clock);
  await source();
  await source();
  assert.equal(calls, 1);
  clock = 101_000;
  await source();
  assert.equal(calls, 2);
});

async function serve(app: http.RequestListener) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const solve = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/api/solve-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ question: 'What is 2 + 2?' }),
  });

for (const mode of ['production', 'development'] as const) {
  test(`${mode}: reviewees cannot use the admin APIs; the verified administrator can`, async () => {
    // No Gemini key, so a request that passes authorization ends at "AI unavailable" (503).
    const env = { GEMINI_API_KEY: '', NEXORA_ADMIN_TOKEN: mode === 'production' ? 'server-secret' : '', NODE_ENV: mode };
    const { base, close } = await serve(createApp(env, { certificates }));
    try {
      const reviewee = await solve(base, { Authorization: `Bearer ${revieweeToken}` });
      assert.equal(reviewee.status, 403);
      assert.match((await reviewee.json()).error, /only available to the NEXORA Academy administrator/);

      // A reviewee can't get in by also guessing at the admin token.
      const mixed = await solve(base, { Authorization: `Bearer ${revieweeToken}`, 'x-nexora-admin-token': 'guess' });
      assert.equal(mixed.status, 403);

      const forged = await solve(base, { Authorization: `Bearer ${sign({ email: ADMIN_EMAIL, email_verified: true }, { key: other.privateKey })}` });
      assert.equal(forged.status, 401);

      const admin = await solve(base, { Authorization: `Bearer ${adminToken}` });
      assert.equal(admin.status, 503);
      assert.match((await admin.json()).error, /GEMINI_API_KEY is not configured/);

      for (const path of ['/api/extract-stream', '/api/extract-pdf', '/api/extraction-jobs']) {
        const res = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${revieweeToken}` },
          body: JSON.stringify({ rawText: '1. Q?\nA. a\nB. b' }),
        });
        assert.equal(res.status, 403, path);
      }

      if (mode === 'production') {
        // Without a sign-in, production still requires the shared admin token.
        assert.equal((await solve(base, {})).status, 401);
        assert.equal((await solve(base, { 'x-nexora-admin-token': 'server-secret' })).status, 503);
      }
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.equal(health.adminSignIn, true);
    } finally {
      await close();
    }
  });
}
