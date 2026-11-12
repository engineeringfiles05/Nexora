/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hosting tests. They run the Express app in-process on an OS-assigned port (listen(0)),
 * so they never collide with other test runs or a dev server on fixed ports.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createApp, SERVERLESS_MAX_UPLOAD_BYTES } from './app.ts';
import { checkDeadline, ExtractionError, runExtraction } from './extraction/pipeline.ts';
import { withRetry, type PageImageReader } from './extraction/imageReader.ts';
import { textBasedExam } from './extraction/testFixtures.ts';
import { getServerCapabilities, runExtractionStream, uploadTooLarge, BACKEND_UNAVAILABLE } from '../src/utils/importerClient.ts';

const BASE_ENV = { GEMINI_API_KEY: '', NEXORA_ADMIN_TOKEN: 't', NODE_ENV: 'production' };

async function serve(app: http.RequestListener) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nexora-admin-token': 't' }, body: JSON.stringify(body) });

test('the Vercel function entry exports the API in serverless mode', async () => {
  const { default: handler } = await import('../api/index.ts');
  const { base, close } = await serve(handler as http.RequestListener);
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.platform, 'serverless');
    assert.equal(health.extractionJobs, false);
    assert.equal(health.maxUploadBytes, SERVERLESS_MAX_UPLOAD_BYTES);
  } finally {
    await close();
  }
});

test('vercel.json routes every /api path to that function, with the time limit and pdf.js data files', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites[0], { source: '/api/:path*', destination: '/api' });
  // Every other address is the web app, so /admin or /dashboard can be opened directly
  // (the app then checks the sign-in), but /api paths never fall through to it.
  const spa = config.rewrites[1];
  assert.equal(spa.destination, '/index.html');
  const pattern = new RegExp(`^${spa.source}$`);
  for (const path of ['/', '/login', '/admin', '/admin/question-bank', '/dashboard', '/apiary']) assert.ok(pattern.test(path), path);
  for (const path of ['/api', '/api/health', '/api/extract-stream']) assert.ok(!pattern.test(path), path);
  const fn = config.functions['api/index.ts'];
  assert.equal(fn.maxDuration, 300);
  assert.match(fn.includeFiles, /pdfjs-dist\/cmaps/);
  assert.match(fn.includeFiles, /pdfjs-dist\/standard_fonts/);
});

test('serverless: jobs are refused clearly, uploads over the request limit are refused, streaming works', async () => {
  const { base, close } = await serve(createApp({ ...BASE_ENV, VERCEL: '1' }));
  try {
    const job = await post(`${base}/api/extraction-jobs`, { rawText: '1. Q?\nA. a\nB. b' });
    assert.equal(job.status, 501);
    assert.equal((await job.json()).code, 'JOBS_UNAVAILABLE');

    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(SERVERLESS_MAX_UPLOAD_BYTES)]).toString('base64');
    const tooBig = await post(`${base}/api/extract-stream`, { base64Pdf: big });
    assert.equal(tooBig.status, 413);
    assert.match((await tooBig.json()).error, /accepts PDFs up to about 3\.1 MB/);

    const f = await textBasedExam();
    const lines = (await (await post(`${base}/api/extract-stream`, { base64Pdf: Buffer.from(f.bytes).toString('base64'), filename: 'a.pdf' })).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.type === 'progress'));
    const last = lines[lines.length - 1];
    assert.equal(last.type, 'result');
    assert.equal(last.result.questions.length, 6);
  } finally {
    await close();
  }
});

test('a long-running server keeps background jobs', async () => {
  const { base, close } = await serve(createApp({ ...BASE_ENV }));
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.platform, 'server');
    assert.equal(health.extractionJobs, true);
    assert.equal((await post(`${base}/api/extraction-jobs`, { rawText: '1. Q?\nA. a\nB. b' })).status, 202);
  } finally {
    await close();
  }
});

test('extraction stops with a clear error before the hosting time limit', async () => {
  assert.throws(() => checkDeadline(1000, 3, 10, 2000), (e: unknown) => e instanceof ExtractionError && e.status === 504 && /3 of 10 page/.test(e.message));
  assert.doesNotThrow(() => checkDeadline(undefined, 0, 10));
  const f = await textBasedExam();
  await assert.rejects(runExtraction({ bytes: f.bytes, filename: 'a.pdf', deadline: Date.now() - 1 }), /more processing time than this hosting allows/);
});

// ---- Deadline and cancellation across awaited work ----

/** A page reader that only finishes when aborted, like a model call that hangs. */
function hangingReader(honoursSignal: boolean) {
  const calls: { aborted: () => boolean }[] = [];
  const reader: PageImageReader = {
    name: 'hanging test reader',
    read(_png, _page, _pass, signal) {
      calls.push({ aborted: () => Boolean(signal?.aborted) });
      return new Promise((_, reject) => {
        if (honoursSignal) signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  return { reader, calls };
}

for (const honoursSignal of [true, false]) {
  test(`a slow page reading stops at the deadline (reader ${honoursSignal ? 'honours' : 'ignores'} the abort signal)`, async () => {
    const f = await textBasedExam();
    const { reader, calls } = hangingReader(honoursSignal);
    const progressAt: number[] = [];
    const started = Date.now();
    let stoppedAt = 0;
    await assert.rejects(
      runExtraction({ bytes: f.bytes, filename: 'a.pdf', reader, deadline: started + 300, onProgress: () => progressAt.push(Date.now()) }).finally(() => {
        stoppedAt = Date.now();
      }),
      (e: unknown) => e instanceof ExtractionError && e.status === 504 && /more processing time than this hosting allows/.test(e.message)
    );
    assert.ok(stoppedAt - started < 2000, `stopped after ${stoppedAt - started} ms`);
    assert.ok(calls.length >= 1 && calls.length <= 2, 'one read per page in flight, no retries');
    assert.ok(calls.every((c) => c.aborted()), 'the reader was told to stop');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(progressAt.every((t) => t <= stoppedAt), 'no progress after the run stopped');
  });
}

test('a client disconnect cancels the run and its page readings', async () => {
  const f = await textBasedExam();
  const { reader, calls } = hangingReader(true);
  const disconnect = new AbortController();
  setTimeout(() => disconnect.abort(), 200);
  await assert.rejects(
    runExtraction({ bytes: f.bytes, filename: 'a.pdf', reader, signal: disconnect.signal }),
    (e: unknown) => e instanceof ExtractionError && e.status === 499
  );
  assert.ok(calls.length > 0 && calls.every((c) => c.aborted()));
});

test('no retries or backoff waits once the run is stopped', async () => {
  const stop = new AbortController();
  let attempts = 0;
  const started = Date.now();
  await assert.rejects(
    withRetry(async () => {
      attempts++;
      stop.abort(new Error('deadline'));
      throw Object.assign(new Error('server busy'), { status: 503 }); // normally retried after 1.5 s
    }, 2, stop.signal),
    /deadline/
  );
  assert.equal(attempts, 1);
  assert.ok(Date.now() - started < 500);
});

// ---- Client side: honest errors when the backend is missing or limited ----

const vercel404: typeof fetch = async () => new Response('The page could not be found\n\nNOT_FOUND', { status: 404, headers: { 'content-type': 'text/plain' } });

test('a host 404 for /api/health means the importer reports the backend as unavailable', async () => {
  const caps = await getServerCapabilities(vercel404);
  assert.equal(caps.available, false);
  await assert.rejects(runExtractionStream({ rawText: 'x', filename: 'x' }, '', () => {}, undefined, vercel404), (e: Error) => e.message === BACKEND_UNAVAILABLE);
});

test('the client reads limits from the server and refuses oversized files before uploading', async () => {
  const { base, close } = await serve(createApp({ ...BASE_ENV, VERCEL: '1' }));
  try {
    const caps = await getServerCapabilities((input, init) => fetch(`${base}${input}`, init));
    assert.equal(caps.available, true);
    assert.equal(caps.extractionJobs, false);
    assert.equal(caps.streamingExtraction, true);
    assert.match(uploadTooLarge(5 * 1024 * 1024, caps) ?? '', /accepts PDFs up to about 3\.1 MB/);
    assert.equal(uploadTooLarge(1024, caps), null);
    const result = await runExtractionStream(
      { rawText: '1. Which is a vector?\nA. mass\nB. velocity', filename: 'v.txt' },
      't',
      () => {},
      undefined,
      (input, init) => fetch(`${base}${input}`, init)
    );
    assert.equal(result.questions[0].question, 'Which is a vector?');
  } finally {
    await close();
  }
});

test('firebase.json deploys firestore.rules to the database and project the web app uses', async () => {
  const web = JSON.parse(await readFile(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const rc = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));
  assert.deepEqual(firebase.firestore, [{ database: web.firestoreDatabaseId, rules: 'firestore.rules' }]);
  assert.equal(rc.projects.default, web.projectId);
});
