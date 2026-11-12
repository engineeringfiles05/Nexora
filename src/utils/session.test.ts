/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cloudQueryPlan, cloudReducer, describeSyncError, emptyCloudState, sortAuditLogs, visibleResults } from './session.ts';
import { RevieweeRosterView } from '../components/RevieweeRosterView.tsx';
import { countdownLabel, getExamCountdown, parseExamDate } from './examDate.ts';
import { DEMO_STORAGE_PREFIX, LEGACY_STORAGE_PREFIX, isRecordArray, loadPersisted, savePersisted } from './persistence.ts';
import { Navbar } from '../components/Navbar.tsx';
import { DEMO_USERS } from '../data/seedData.ts';
import type { AuditLog, ExamResult, Question } from '../types/index.ts';

// ---- Finding 1: queries must match firestore.rules for the role ----

test('reviewee queries are filtered the way firestore.rules requires; admins list everything', () => {
  // Reviewees never query the admin-only users and auditLogs collections, and only see
  // material of their own course.
  assert.deepEqual(cloudQueryPlan('reviewee', 'uid-1', 'RME'), {
    questions: [
      { field: 'isPublished', value: true },
      { field: 'course', value: 'RME' },
    ],
    pdfSources: [
      { field: 'isPublicToReviewees', value: true },
      { field: 'course', value: 'RME' },
    ],
    examResults: [{ field: 'userId', value: 'uid-1' }],
  });
  // Without a course (not chosen yet, or removed by the administrator) only their own history.
  assert.deepEqual(cloudQueryPlan('reviewee', 'uid-1', null), { examResults: [{ field: 'userId', value: 'uid-1' }] });
  assert.deepEqual(cloudQueryPlan('reviewee', 'uid-1'), { examResults: [{ field: 'userId', value: 'uid-1' }] });
  assert.deepEqual(cloudQueryPlan('admin', 'uid-1'), { questions: null, pdfSources: null, examResults: null, auditLogs: null, users: null });
});

test('users and auditLogs are admin-only in the rules too', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/users\/\{userId\}[\s\S]*?allow list: if isAdmin\(\);/);
  assert.match(rules, /match \/auditLogs\/\{logId\}[\s\S]*?allow list: if isAdmin\(\);/);
  assert.match(rules, /match \/auditLogs\/\{logId\}[\s\S]*?allow get, write: if isAdmin\(\) && isValidId\(logId\);/);
  // A document-id check on list would make every audit-log query fail, even for admins.
  assert.doesNotMatch(rules, /match \/auditLogs\/\{logId\}[^}]*allow (read|list)[^;]*isValidId/);
});

test('admin audit history comes from Firestore, survives reloads, and respects empty or failed loads', () => {
  let s = cloudReducer(emptyCloudState('admin'), {
    type: 'snapshot',
    uid: 'admin',
    collection: 'auditLogs',
    docs: [{ id: 'log-1000-a' }, { id: 'log-3000-c' }, { id: 'log-2000-b' }],
  });
  assert.deepEqual(sortAuditLogs(s.auditLogs as AuditLog[]).map((l) => l.id), ['log-3000-c', 'log-2000-b', 'log-1000-a']);
  s = cloudReducer(s, { type: 'snapshot', uid: 'admin', collection: 'auditLogs', docs: [] });
  assert.deepEqual(s.auditLogs, []);
  s = cloudReducer(s, { type: 'error', uid: 'admin', collection: 'auditLogs', message: describeSyncError('auditLogs', { code: 'permission-denied' }) });
  assert.match(s.errors.auditLogs ?? '', /not allowed to load the audit log/);
  // A fresh account starts with nothing loaded, not another account's history.
  assert.equal(cloudReducer(s, { type: 'reset', uid: 'other' }).auditLogs, null);
});

test('App subscribes from the role plan, and the roster lists registered reviewee accounts', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const auditLogs = sortAuditLogs\(cloud\.auditLogs \?\? \[\]\)/);
  assert.match(app, /const rosterReviewees: UserProfile\[\] = \(cloud\.users \?\? \[\]\)\.filter\(\(u\) => u\.role === 'reviewee'\)/);
  assert.match(app, /reviewees=\{rosterReviewees\}/);
  assert.doesNotMatch(app, /DEMO_USERS/);
});

test('the roster shows honest loading, empty and error states', () => {
  const render = (props: Partial<React.ComponentProps<typeof RevieweeRosterView>>) =>
    renderToStaticMarkup(React.createElement(RevieweeRosterView, { reviewees: [], examResults: [], ...props }));
  assert.match(render({ loading: true }), /Loading registered reviewees/);
  assert.match(render({}), /No reviewee accounts yet/);
  assert.match(render({ error: 'Your account is not allowed to load registered reviewees.' }), /not allowed to load registered reviewees/);
  assert.match(render({ reviewees: [DEMO_USERS[1]] }), /Mark Lawrence Cruz/);
  assert.doesNotMatch(render({ loading: true, reviewees: [DEMO_USERS[1]] }), /Mark Lawrence Cruz/);
});

test('the filters match the rules file, so a rules change cannot drift silently', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/questions\/\{questionId\}[\s\S]*?allow list: if isAdmin\(\) \|\|\s*\(isActiveReviewee\(\) && resource\.data\.isPublished == true && resource\.data\.course == myCourse\(\)\)/);
  assert.match(rules, /match \/pdfSources\/\{pdfSourceId\}[\s\S]*?allow list: if isAdmin\(\) \|\|\s*\(isActiveReviewee\(\) && resource\.data\.isPublicToReviewees == true && resource\.data\.course == myCourse\(\)\)/);
  assert.match(rules, /match \/examResults\/\{resultId\}[\s\S]*?allow list: if isSignedIn\(\) && \(resource\.data\.userId == request\.auth\.uid \|\| isAdmin\(\)\)/);
});

test('App builds its listeners from the role plan and never queries whole collections for reviewees', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /cloudQueryPlan\(accountRole, signedInUid, accountCourse\)/);
  assert.match(app, /filters\.map\(\(f\) => where\(f\.field, '==', f\.value\)\)/);
  assert.doesNotMatch(app, /onSnapshot\(\s*collection\(db, '(questions|pdfSources)'\)/);
  // Listener failures reach the UI, not only the console.
  assert.match(app, /type: 'error', uid: signedInUid, collection: name/);
});

test('permission errors become readable messages', () => {
  assert.match(describeSyncError('questions', { code: 'permission-denied' }), /not allowed to load questions/);
  assert.match(describeSyncError('write', new Error('Missing or insufficient permissions.')), /not allowed to save/);
  assert.match(describeSyncError('examResults', new Error('offline')), /Could not load exam history/);
});

// ---- Finding 2: account data is separate, respects empty snapshots, clears on switch ----

const q = (id: string) => ({ id }) as Question;
const r = (id: string, userId: string) => ({ id, userId }) as ExamResult;

test('an empty snapshot replaces old data instead of being ignored', () => {
  let s = cloudReducer(emptyCloudState('a'), { type: 'snapshot', uid: 'a', collection: 'questions', docs: [q('1'), q('2')] });
  assert.equal(s.questions?.length, 2);
  s = cloudReducer(s, { type: 'snapshot', uid: 'a', collection: 'questions', docs: [] });
  assert.deepEqual(s.questions, []); // deleting the last cloud record empties the bank
});

test('switching accounts clears everything and ignores late callbacks from the old account', () => {
  let s = cloudReducer(emptyCloudState('admin-uid'), { type: 'snapshot', uid: 'admin-uid', collection: 'examResults', docs: [r('x', 'someone')] });
  s = cloudReducer(s, { type: 'error', uid: 'admin-uid', collection: 'write', message: 'x' });
  s = cloudReducer(s, { type: 'reset', uid: 'reviewee-uid' });
  assert.equal(s.examResults, null); // loading, not the admin's data
  assert.deepEqual(s.errors, {});
  s = cloudReducer(s, { type: 'snapshot', uid: 'admin-uid', collection: 'examResults', docs: [r('late', 'someone')] });
  assert.equal(s.examResults, null);
  s = cloudReducer(s, { type: 'reset', uid: null }); // sign-out
  assert.equal(s.uid, null);
  assert.equal(s.questions, null);
});

test('a successful snapshot clears that collection\'s error; dismiss clears a save error', () => {
  let s = cloudReducer(emptyCloudState('a'), { type: 'error', uid: 'a', collection: 'questions', message: 'denied' });
  s = cloudReducer(s, { type: 'error', uid: 'a', collection: 'write', message: 'save failed' });
  s = cloudReducer(s, { type: 'snapshot', uid: 'a', collection: 'questions', docs: [] });
  assert.deepEqual(Object.keys(s.errors), ['write']);
  s = cloudReducer(s, { type: 'dismiss', uid: 'a', key: 'write' });
  assert.deepEqual(s.errors, {});
});

test('reviewees only see their own results; admins see all', () => {
  const results = [r('1', 'me'), r('2', 'other'), r('3', 'me')];
  assert.deepEqual(visibleResults({ id: 'me', role: 'reviewee' }, results).map((x) => x.id), ['1', '3']);
  assert.equal(visibleResults({ id: 'me', role: 'admin' }, results).length, 3);
});

test('signed-in data never touches the shared browser cache', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  // Account data comes only from the reducer, which is filled from Firestore.
  assert.match(app, /const questions = cloud\.questions \?\? \[\]/);
  assert.match(app, /const examResults = cloud\.examResults \?\? \[\]/);
  assert.match(app, /dispatchCloud\(\{ type: 'reset', uid: user\?\.uid \?\? null \}\)/);
});

test('demo state never hydrates from the legacy shared cache, and leaves it untouched', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  // A previous signed-in account's data, saved under the old mixed keys.
  const legacy = JSON.stringify([{ id: 'account-question' }]);
  data.set(`${LEGACY_STORAGE_PREFIX}questions`, legacy);
  data.set(`${LEGACY_STORAGE_PREFIX}results`, JSON.stringify([{ id: 'account-result', userId: 'real-uid' }]));

  const seed = [{ id: 'demo-seed' }];
  assert.deepEqual(loadPersisted('questions', seed, isRecordArray, storage, DEMO_STORAGE_PREFIX), seed);
  assert.deepEqual(loadPersisted('results', seed, isRecordArray, storage, DEMO_STORAGE_PREFIX), seed);

  assert.equal(savePersisted('questions', [{ id: 'demo-edit' }], storage, DEMO_STORAGE_PREFIX), true);
  assert.equal(data.get(`${LEGACY_STORAGE_PREFIX}questions`), legacy); // preserved, not overwritten
  assert.equal(data.get(`${DEMO_STORAGE_PREFIX}questions`), JSON.stringify([{ id: 'demo-edit' }]));
  assert.notEqual(DEMO_STORAGE_PREFIX, LEGACY_STORAGE_PREFIX);
});

test('App keeps no account data or sign-in state in browser storage', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /usePersistentState|useDemoPersistentState|localStorage|sessionStorage/);
});

// ---- Finding 3: roles come from the account, never from a switch in the app ----

test('the navbar shows the account role and offers no role switcher', () => {
  const props = { currentView: 'reviewee-dashboard', onNavigate: () => {}, pendingVerificationCount: 0, onLogout: () => {} };
  const reviewee = renderToStaticMarkup(React.createElement(Navbar, { ...props, currentUser: { ...DEMO_USERS[1], course: 'RME' as const } }));
  assert.match(reviewee, /Reviewee · RME/);
  assert.doesNotMatch(reviewee, /Demo Role|Signed-in role:|Question Bank|Audit Logs/);
  const admin = renderToStaticMarkup(React.createElement(Navbar, { ...props, currentUser: DEMO_USERS[0] }));
  assert.match(admin, /Administrator/);
  assert.match(admin, /Question Bank/);
});

test('App has no demo role switching and routes every page through resolveRoute', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /handleSwitchRole|canSwitchDemoRole|setCurrentUser/);
  assert.match(app, /resolveRoute\(requestedView, session\)/);
});

// ---- Finding 4: honest exam countdown from one configured date ----

const nov9 = new Date(2026, 10, 9, 15, 30); // 9 Nov 2026, afternoon local time

test('no configured date means no countdown, never an invented one', () => {
  assert.deepEqual(getExamCountdown(undefined, nov9), { state: 'unconfigured' });
  assert.equal(countdownLabel(getExamCountdown(undefined, nov9)), 'Exam date not set');
  assert.equal(getExamCountdown('September 2026', nov9).state, 'invalid');
  assert.equal(parseExamDate('2026-02-30'), null);
});

test('countdown is computed from the configured date in whole calendar days', () => {
  const up = getExamCountdown('2026-11-19', nov9);
  assert.equal(up.state, 'upcoming');
  assert.equal(countdownLabel(up), '10 days remaining');
  assert.equal(countdownLabel(getExamCountdown('2026-11-10', nov9)), '1 day remaining');
  assert.equal(getExamCountdown('2026-11-09', nov9).state, 'today');
});

test('a past date says so instead of counting down', () => {
  const past = getExamCountdown('2026-09-01', nov9);
  assert.equal(past.state, 'past');
  assert.match(countdownLabel(past), /^Exam date passed/);
});

test('the fixed "148 Days Remaining" and "September 2026" fallbacks are gone', async () => {
  const navbar = await readFile(new URL('../components/Navbar.tsx', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../components/RevieweeDashboard.tsx', import.meta.url), 'utf8');
  const seed = await readFile(new URL('../data/seedData.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(navbar, /148 Days/);
  assert.doesNotMatch(dashboard, /September 2026/);
  assert.doesNotMatch(seed, /examDate:/);
});
