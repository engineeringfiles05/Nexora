import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRateLimiter, tokensMatch } from './aiGuards.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const children: ChildProcess[] = [];
after(() => children.forEach((child) => child.kill()));

/** Starts the real server. GEMINI_API_KEY is blanked, so no test can call Gemini. */
async function startServer(port: number, env: Record<string, string>): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      GEMINI_API_KEY: '',
      NEXORA_ADMIN_TOKEN: '',
      AI_EXTRACT_HOURLY_LIMIT: '',
      ...env,
    },
    stdio: 'ignore',
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return base;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('server did not start');
}

const post = (url: string, body: unknown, token?: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-nexora-admin-token': token } : {}) },
    body: JSON.stringify(body),
  });

test('unknown API routes return a JSON 404 instead of the SPA page', async () => {
  const base = await startServer(3311, {});
  for (const method of ['GET', 'POST']) {
    const response = await fetch(`${base}/api/nonexistent`, { method });
    assert.equal(response.status, 404, method);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.match((await response.json()).error, /not found/i);
  }
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('production fails closed when no admin token is configured', async () => {
  const base = await startServer(3312, {});
  for (const route of ['extract-pdf', 'solve-question']) {
    const response = await post(`${base}/api/${route}`, { rawText: 'x', question: 'x' });
    assert.equal(response.status, 503, route);
    assert.match((await response.json()).error, /NEXORA_ADMIN_TOKEN/);
  }
});

test('AI routes need the right token, then validate input, then need a Gemini key', async () => {
  const base = await startServer(3313, { NEXORA_ADMIN_TOKEN: 'correct-token' });
  const route = `${base}/api/extract-pdf`;
  assert.equal((await post(route, { rawText: 'x' })).status, 401);
  assert.equal((await post(route, { rawText: 'x' }, 'wrong-token')).status, 401);
  assert.equal((await post(route, {}, 'correct-token')).status, 400);
  assert.equal((await post(route, { rawText: 123 }, 'correct-token')).status, 400);
  assert.equal((await post(route, { rawText: 'x' }, 'correct-token')).status, 503);

  const solve = `${base}/api/solve-question`;
  assert.equal((await post(solve, { question: 'x' })).status, 401);
  assert.equal((await post(solve, {}, 'correct-token')).status, 400);
  assert.equal((await post(solve, { question: 'x'.repeat(5001) }, 'correct-token')).status, 413);
  assert.equal((await post(solve, { question: 'x', options: 'nope' }, 'correct-token')).status, 400);
  assert.equal((await post(solve, { question: 'x' }, 'correct-token')).status, 503);
});

test('malformed and oversized bodies get JSON errors', async () => {
  const base = await startServer(3314, { NEXORA_ADMIN_TOKEN: 't' });
  const malformed = await fetch(`${base}/api/solve-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nexora-admin-token': 't' },
    body: '{not json',
  });
  assert.equal(malformed.status, 400);
  assert.ok((await malformed.json()).error);

  const oversized = await post(`${base}/api/solve-question`, { question: 'x'.repeat(2 * 1024 * 1024) }, 't');
  assert.equal(oversized.status, 413);
  assert.ok((await oversized.json()).error);
});

test('AI usage over the limit gets 429 with Retry-After', async () => {
  const base = await startServer(3315, { NEXORA_ADMIN_TOKEN: 't', AI_EXTRACT_HOURLY_LIMIT: '2' });
  const route = `${base}/api/extract-pdf`;
  assert.equal((await post(route, { rawText: 'x' }, 't')).status, 503);
  assert.equal((await post(route, { rawText: 'x' }, 't')).status, 503);
  const limited = await post(route, { rawText: 'x' }, 't');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  // Rejected callers don't use up the allowance.
  assert.equal((await post(route, { rawText: 'x' })).status, 401);
});

test('rate limiter resets after its window and tracks clients separately', () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => clock });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const denied = limiter.check('a');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.check('b').allowed, true);
  clock = 1000;
  assert.equal(limiter.check('a').allowed, true);
});

test('token comparison handles different lengths', () => {
  assert.equal(tokensMatch('same', 'same'), true);
  assert.equal(tokensMatch('short', 'a-much-longer-value'), false);
});
