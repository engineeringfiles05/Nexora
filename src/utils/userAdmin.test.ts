/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ExamResult, UserProfile } from '../types/index.ts';
import { DEFAULT_USER_QUERY, computeUserStats, filterUsers, paginate, summarizePerformance, weeklyRegistrations } from './userAdmin.ts';
import { blockedMessage, canAccessPlatform, contentCourse, statusOf } from '../auth/accountStatus.ts';
import { buildProfile } from '../auth/authService.ts';
import { publishQuestionsToBank } from './bank.ts';
import { resolveRoute } from '../auth/routes.ts';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();

const user = (id: string, extra: Partial<UserProfile> = {}): UserProfile => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.com`,
  role: 'reviewee',
  avatar: '',
  enrolledAt: daysAgo(30),
  ...extra,
});

const users: UserProfile[] = [
  user('a', { name: 'Ana Reyes', course: 'REE', enrolledAt: daysAgo(2), lastLoginAt: daysAgo(1) }),
  user('b', { name: 'Ben Cruz', course: 'RME', status: 'suspended', enrolledAt: daysAgo(20), lastLoginAt: daysAgo(15) }),
  user('c', { name: 'Carla Santos', course: 'REE', status: 'inactive', enrolledAt: daysAgo(40) }),
  user('d', { name: 'Dan Lim', status: 'pending', enrolledAt: daysAgo(1) }),
  user('e', { name: 'Eli Tan', course: null, enrolledAt: daysAgo(60), lastLoginAt: daysAgo(3) }), // legacy: no status = active
];

// ---- Status ----

test('profiles without a status are active; only active accounts may use the platform', () => {
  assert.equal(statusOf({}), 'active');
  assert.equal(statusOf({ status: 'bogus' as any }), 'active');
  assert.equal(canAccessPlatform({ status: 'active' }), true);
  for (const status of ['inactive', 'suspended', 'pending'] as const) assert.equal(canAccessPlatform({ status }), false);
  assert.match(blockedMessage({ status: 'suspended', statusReason: 'Sharing answers' }), /suspended\. Reason: Sharing answers/);
  assert.match(blockedMessage({ status: 'pending' }), /waiting for approval/);
});

test('the owner is always active; a stored "admin" role or status grants nothing to anyone else', () => {
  const owner = buildProfile({ uid: 'o', email: 'engineeringfiles05@gmail.com', emailVerified: true, displayName: 'Owner', photoURL: null }, { status: 'suspended' });
  assert.equal(owner.status, 'active');
  const reviewee = buildProfile({ uid: 'r', email: 'r@example.com', emailVerified: true, displayName: null, photoURL: null }, { role: 'admin', status: 'suspended', course: null });
  assert.equal(reviewee.role, 'reviewee');
  assert.equal(reviewee.status, 'suspended');
  assert.equal(reviewee.course, null);
});

test('material without a course is REE; question sets carry their course to published questions', () => {
  assert.equal(contentCourse({}), 'REE');
  assert.equal(contentCourse({ course: 'RME' }), 'RME');
  const source = { id: 's1', filename: 'rme.pdf', course: 'RME' } as any;
  const q = { id: 'q1', question: 'Q', options: [], contentFingerprint: 'x' } as any;
  const published = publishQuestionsToBank([], [], [q], source);
  assert.equal(published.questions[0]!.course, 'RME');
  assert.equal(publishQuestionsToBank([], [], [q], { id: 's2', filename: 'old.pdf' } as any).questions[0]!.course, 'REE');
});

test('the user management page is admin-only', () => {
  assert.deepEqual(resolveRoute('user-management', { status: 'signed-in', role: 'reviewee' }), { view: 'reviewee-dashboard', denied: true });
  assert.equal(resolveRoute('user-management', { status: 'signed-in', role: 'admin' }).view, 'user-management');
  assert.equal(resolveRoute('user-management', { status: 'signed-out' }).view, 'login');
});

// ---- Statistics, filters, sorting, paging ----

test('statistics count every status, new registrations and recent sign-ins', () => {
  assert.deepEqual(computeUserStats(users, NOW), {
    total: 5,
    active: 2,
    inactive: 1,
    pending: 1,
    suspended: 1,
    newlyRegistered: 2,
    recentlyActive: 2,
    byCourse: { REE: 2, RME: 1, none: 2 },
  });
});

test('quick filters, course, dates and search narrow the list', () => {
  const ids = (q: Partial<typeof DEFAULT_USER_QUERY>) => filterUsers(users, { ...DEFAULT_USER_QUERY, ...q }, NOW).map((u) => u.id);
  assert.deepEqual(ids({ quick: 'suspended' }), ['b']);
  assert.deepEqual(ids({ quick: 'pending' }), ['d']);
  assert.deepEqual(ids({ quick: 'active' }).sort(), ['a', 'e']);
  assert.deepEqual(ids({ quick: 'recent' }).sort(), ['a', 'd']);
  assert.deepEqual(ids({ course: 'RME' }), ['b']);
  assert.deepEqual(ids({ course: 'none' }).sort(), ['d', 'e']);
  assert.deepEqual(ids({ search: 'santos' }), ['c']);
  assert.deepEqual(ids({ search: 'b@example' }), ['b']);
  assert.deepEqual(ids({ search: 'ree inactive' }), ['c']); // course and status are searchable
  const from = new Date(NOW - 25 * 864e5).toISOString().slice(0, 10);
  const to = new Date(NOW - 10 * 864e5).toISOString().slice(0, 10);
  assert.deepEqual(ids({ registeredFrom: from, registeredTo: to }), ['b']);
});

test('sorting by name, registration date and last login', () => {
  const by = (sort: any, direction: 'asc' | 'desc') => filterUsers(users, { ...DEFAULT_USER_QUERY, sort, direction }, NOW).map((u) => u.id);
  assert.deepEqual(by('name', 'asc'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(by('enrolledAt', 'desc'), ['d', 'a', 'b', 'c', 'e']);
  assert.deepEqual(by('lastLoginAt', 'desc').slice(0, 3), ['a', 'e', 'b']);
});

test('pagination clamps to the available pages', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(paginate(items, 3, 20), { items: [40, 41, 42, 43, 44], page: 3, pages: 3 });
  assert.equal(paginate(items, 99, 20).page, 3);
  assert.deepEqual(paginate([], 1, 20), { items: [], page: 1, pages: 1 });
});

test('weekly registrations put each account in its week', () => {
  const weeks = weeklyRegistrations(users, 8, NOW);
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7]!.count, 2); // a and d, this week
  assert.equal(weeks.reduce((n, w) => n + w.count, 0), 4); // e (60 days) is older than 8 weeks
});

// ---- Performance ----

const result = (id: string, type: ExamResult['type'], score: number, day: number, userId = 'a'): ExamResult =>
  ({
    id,
    userId,
    type,
    title: `${type} ${id}`,
    completedAt: daysAgo(day),
    scorePercentage: score,
    isPassed: score >= 70,
    subjectBreakdown: { ee: { subjectName: 'Electrical Engineering', total: 10, correct: Math.round(score / 10), percentage: score, passed: score >= 70 } },
    weakTopics: score < 70 ? ['Power Systems'] : [],
    strongTopics: [],
  }) as unknown as ExamResult;

test('performance summary per exam type, subject and over time', () => {
  const results = [
    result('1', 'pre_test', 50, 30),
    result('2', 'quiz', 60, 20),
    result('3', 'quiz', 70, 15),
    result('4', 'pre_board', 80, 10),
    result('5', 'final_mock', 90, 5),
    result('x', 'quiz', 10, 1, 'someone-else'),
  ];
  const s = summarizePerformance('a', results);
  assert.equal(s.attempts, 5);
  assert.equal(s.average, 70);
  assert.equal(s.passRate, 60);
  const quiz = s.byType.find((t) => t.type === 'quiz')!;
  assert.deepEqual([quiz.attempts, quiz.best, quiz.latest, quiz.passed], [2, 70, 70, 1]);
  assert.equal(s.byType.find((t) => t.type === 'final_mock')!.latest, 90);
  assert.deepEqual(s.timeline.map((p) => p.score), [50, 60, 70, 80, 90]);
  assert.equal(s.trend, 20); // last three (70, 80, 90) vs first three (50, 60, 70)
  assert.deepEqual(s.bySubject, [{ subjectId: 'ee', name: 'Electrical Engineering', attempts: 5, percentage: 70 }]);
  assert.deepEqual(s.weakTopics, ['Power Systems']);
  assert.equal(summarizePerformance('nobody', results).average, null);
});

// ---- Rules ----

test('firestore.rules: blocked accounts lose access, courses restrict materials, the admin keeps their own account', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function isActiveReviewee\(\) \{\s*return isSignedIn\(\) && exists\(profilePath\(\)\) && get\(profilePath\(\)\)\.data\.get\('status', 'active'\) == 'active';/);
  // Every reviewee read of review material needs an active profile and the same course.
  for (const collection of ['questions\\/\\{questionId\\}', 'pdfSources\\/\\{pdfSourceId\\}']) {
    const block = new RegExp(`match \\/${collection} \\{([\\s\\S]*?)\\n    \\}`).exec(rules)?.[1] ?? '';
    assert.equal((block.match(/isActiveReviewee\(\)/g) ?? []).length, 2, collection);
    assert.equal((block.match(/resource\.data\.course == myCourse\(\)/g) ?? []).length, 2, collection);
  }
  // Only active accounts add exam results.
  assert.match(rules, /allow create: if isValidId\(resultId\) && incoming\(\)\.userId == request\.auth\.uid && \(isActiveReviewee\(\) \|\| isAdmin\(\)\)/);
  // The administrator creates reviewees (never admins) for others.
  assert.match(rules, /allow create: if isAdmin\(\) && isValidId\(userId\) && request\.auth\.uid != userId &&\s*isValidProfile\(incoming\(\), userId\) &&\s*incoming\(\)\.role == 'reviewee';/);
  // Self-registration can't claim to be created by the admin, and starts pending when required.
  assert.match(rules, /isAllowedNewStatus\(incoming\(\)\) &&\s*!\('createdBy' in incoming\(\)\)/);
  assert.match(rules, /data\.get\('status', 'active'\) == 'pending' \|\|\s*\(data\.get\('status', 'active'\) == 'active' && !requiresApproval\(\)\)/);
  // Only the admin changes the approval setting.
  assert.match(rules, /match \/settings\/\{settingId\} \{[\s\S]*?allow write: if isAdmin\(\) && settingId == 'registration'/);
});
