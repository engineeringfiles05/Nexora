/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADMIN_EMAIL, isAdminEmail, roleForIdentity } from './roles.ts';
import {
  createLoginThrottle,
  describeAuthError,
  isValidEmail,
  passwordProblem,
  passwordStrength,
  sanitizeContact,
  sanitizeName,
  validateLogin,
  validateRegistration,
  type RegistrationForm,
} from './validation.ts';
import { homeFor, resolveRoute, ROUTES, viewForPath, pathForView, type View } from './routes.ts';
import { IDLE_TIMEOUT_MS, REMEMBERED_MAX_AGE_MS, SESSION_MAX_AGE_MS, isIdleExpired, isSessionExpired, readRememberPreference, writeRememberPreference } from './sessionPolicy.ts';
import { buildProfile } from './authService.ts';

// ---- Roles ----

test('only the verified owner account is an administrator', () => {
  assert.equal(roleForIdentity({ email: ADMIN_EMAIL, emailVerified: true }), 'admin');
  assert.equal(roleForIdentity({ email: ADMIN_EMAIL.toUpperCase(), emailVerified: true }), 'admin');
  assert.equal(roleForIdentity({ email: ADMIN_EMAIL, emailVerified: false }), 'reviewee'); // unverified look-alike
  assert.equal(roleForIdentity({ email: 'someone@example.com', emailVerified: true }), 'reviewee');
  assert.equal(roleForIdentity({ email: null }), 'reviewee');
  assert.equal(isAdminEmail(` ${ADMIN_EMAIL} `), true);
});

test('a new profile is always a reviewee, whatever role was stored', () => {
  const user = { uid: 'u1', email: 'new@example.com', emailVerified: false, displayName: null, photoURL: null };
  const fresh = buildProfile(user, { name: 'Juan Dela Cruz', course: 'RME' });
  assert.equal(fresh.role, 'reviewee');
  assert.equal(fresh.course, 'RME');
  assert.match(fresh.targetExam ?? '', /Registered Master Electrician/);
  // A tampered profile document claiming "admin" grants nothing.
  assert.equal(buildProfile(user, { role: 'admin', name: 'X' }).role, 'reviewee');
  assert.equal(buildProfile({ ...user, email: ADMIN_EMAIL, emailVerified: true }, null).role, 'admin');
});

// ---- Validation ----

const valid: RegistrationForm = {
  name: 'Juan A. Dela Cruz',
  email: 'juan@example.com',
  password: 'Review2026!',
  confirmPassword: 'Review2026!',
  course: 'REE',
  contactNumber: '',
  acceptedTerms: true,
};

test('a complete registration passes validation', () => {
  assert.deepEqual(validateRegistration(valid), {});
  assert.deepEqual(validateRegistration({ ...valid, contactNumber: '+63 917 123 4567' }), {});
});

test('registration requires every field, a matching password, a course and the terms', () => {
  const errors = validateRegistration({ name: '', email: '', password: '', confirmPassword: '', course: '', contactNumber: '', acceptedTerms: false });
  assert.deepEqual(Object.keys(errors).sort(), ['acceptedTerms', 'confirmPassword', 'course', 'email', 'name', 'password']);
  assert.match(validateRegistration({ ...valid, confirmPassword: 'Different1' }).confirmPassword ?? '', /do not match/);
  assert.match(validateRegistration({ ...valid, email: 'not-an-email' }).email ?? '', /valid email/);
  assert.ok(validateRegistration({ ...valid, password: 'short1', confirmPassword: 'short1' }).password);
  assert.ok(validateRegistration({ ...valid, password: 'lettersonly', confirmPassword: 'lettersonly' }).password);
  assert.ok(validateRegistration({ ...valid, contactNumber: '12' }).contactNumber);
  assert.ok(validateRegistration({ ...valid, course: 'admin' as any }).course);
});

test('the owner address cannot be registered through the public form', () => {
  assert.match(validateRegistration({ ...valid, email: ADMIN_EMAIL }).email ?? '', /reserved/);
});

test('email format checks', () => {
  for (const ok of ['a@b.co', 'first.last+tag@school.edu.ph', ' Juan@Example.com ']) assert.ok(isValidEmail(ok), ok);
  for (const bad of ['', 'a@b', 'a b@c.com', '@c.com', 'a@.c', 'a@b.c']) assert.ok(!isValidEmail(bad), bad);
  assert.deepEqual(validateLogin('', ''), { email: 'Enter your email address.', password: 'Enter your password.' });
});

test('inputs are sanitised', () => {
  assert.equal(sanitizeName('  Juan   <b>Dela</b>\u0000 Cruz '), 'Juan bDela/b Cruz');
  assert.equal(sanitizeContact(' +63 (917) 123-4567 ext'), '+63 (917) 123-4567');
});

test('password strength grows with length and variety', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('abc').label, 'Too short');
  assert.ok(passwordStrength('abcdefgh').score < passwordStrength('Abcdefg1').score);
  assert.equal(passwordStrength('Abcdefgh1!xyz').label, 'Strong');
  assert.equal(passwordProblem('abcdefg1'), null);
});

test('auth errors become clear messages, without saying which part was wrong', () => {
  assert.equal(describeAuthError({ code: 'auth/wrong-password' }), 'Incorrect email or password.');
  assert.equal(describeAuthError({ code: 'auth/user-not-found' }), 'Incorrect email or password.');
  assert.equal(describeAuthError({ code: 'auth/invalid-credential' }), 'Incorrect email or password.');
  assert.match(describeAuthError({ code: 'auth/email-already-in-use' }), /already exists/);
  assert.match(describeAuthError({ code: 'auth/too-many-requests' }), /Too many attempts/);
  assert.match(describeAuthError({ code: 'auth/expired-action-code' }), /expired/);
});

test('repeated failed sign-ins are slowed down, and a success resets the count', () => {
  let clock = 0;
  const throttle = createLoginThrottle({ freeAttempts: 3, baseDelayMs: 1000, now: () => clock });
  throttle.fail();
  throttle.fail();
  assert.equal(throttle.waitMs(), 0);
  throttle.fail();
  assert.equal(throttle.waitMs(), 1000);
  clock = 1000;
  throttle.fail();
  assert.equal(throttle.waitMs(), 2000); // doubles
  throttle.succeed();
  assert.equal(throttle.waitMs(), 0);
});

// ---- Routes ----

const signedOut = { status: 'signed-out' } as const;
const reviewee = { status: 'signed-in', role: 'reviewee' } as const;
const admin = { status: 'signed-in', role: 'admin' } as const;
const adminViews = (Object.keys(ROUTES) as View[]).filter((v) => ROUTES[v].access === 'admin');

test('signed out, every protected page goes to sign-in; the auth pages stay reachable', () => {
  for (const view of Object.keys(ROUTES) as View[]) {
    const expected = ROUTES[view].access === 'public' ? view : 'login';
    assert.equal(resolveRoute(view, signedOut).view, expected, view);
  }
  assert.equal(resolveRoute(null, signedOut).view, 'login');
});

test('reviewees cannot open admin pages, even by typing the address', () => {
  assert.ok(adminViews.length >= 6);
  for (const view of adminViews) {
    const decision = resolveRoute(viewForPath(pathForView(view)), reviewee);
    assert.deepEqual(decision, { view: 'reviewee-dashboard', denied: true }, view);
  }
  assert.equal(resolveRoute(viewForPath('/admin/'), reviewee).view, 'reviewee-dashboard');
});

test('after sign-in each role lands on its own dashboard; the administrator can open admin pages', () => {
  assert.equal(resolveRoute(viewForPath('/login'), reviewee).view, 'reviewee-dashboard');
  assert.equal(resolveRoute(viewForPath('/login'), admin).view, 'admin-dashboard');
  assert.equal(resolveRoute(viewForPath('/register'), admin).view, 'admin-dashboard');
  assert.equal(homeFor('admin'), 'admin-dashboard');
  for (const view of adminViews) assert.equal(resolveRoute(view, admin).view, view);
  assert.equal(resolveRoute('account', reviewee).view, 'account');
  // A reset link still works while signed in.
  assert.equal(resolveRoute(viewForPath('/auth/action'), reviewee).view, 'reset-password');
});

test('every page has its own address', () => {
  const paths = Object.values(ROUTES).map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(viewForPath('/nowhere'), null);
});

// ---- Sessions ----

test('session lifetimes depend on "Remember me", and exams are never interrupted for inactivity', () => {
  const start = 1_000_000;
  assert.equal(isSessionExpired(start, true, start + REMEMBERED_MAX_AGE_MS - 1), false);
  assert.equal(isSessionExpired(start, true, start + REMEMBERED_MAX_AGE_MS + 1), true);
  assert.equal(isSessionExpired(start, false, start + SESSION_MAX_AGE_MS + 1), true);
  assert.equal(isSessionExpired(NaN, false, start), false);
  assert.equal(isIdleExpired(start, false, false, start + IDLE_TIMEOUT_MS + 1), true);
  assert.equal(isIdleExpired(start, false, true, start + IDLE_TIMEOUT_MS + 1), false);
  assert.equal(isIdleExpired(start, true, false, start + IDLE_TIMEOUT_MS + 1), false);
});

test('only the "Remember me" choice is stored, never credentials', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readRememberPreference(storage), false);
  writeRememberPreference(true, storage);
  assert.equal(readRememberPreference(storage), true);
  assert.deepEqual([...data.values()], ['true']);
});

// ---- Firestore rules ----

test('firestore.rules: only the verified owner is admin, and nobody can give themselves a role', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const isAdmin = /function isAdmin\(\) \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
  assert.match(isAdmin, new RegExp(`request\\.auth\\.token\\.email == '${ADMIN_EMAIL.replace(/\./g, '\\.')}'`));
  assert.match(isAdmin, /email_verified == true/);
  assert.doesNotMatch(isAdmin, /admins|resource\.data/); // no self-granted admin documents or profile roles
  assert.match(rules, /data\.role == 'reviewee' \|\| \(data\.role == 'admin' && isAdmin\(\) && request\.auth\.uid == userId\)/);
  const users = /match \/users\/\{userId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? '';
  assert.match(users, /allow create:[^;]*request\.auth\.uid == userId[^;]*incoming\(\)\.email == request\.auth\.token\.email[^;]*isAllowedRole/);
  // Reviewees can't change their email, status or (once chosen) course; nobody demotes the owner.
  assert.match(users, /allow update: if isSignedIn\(\)[^;]*request\.auth\.uid == userId && !isAdmin\(\)[^;]*incoming\(\)\.email == existing\(\)\.email[^;]*unchanged\('status'\)[^;]*\(unchanged\('course'\) \|\| !\('course' in existing\(\)\)\)[^;]*incoming\(\)\.role == 'reviewee'/);
  assert.match(users, /allow update: if isAdmin\(\)[^;]*isAllowedRole[^;]*request\.auth\.uid != userId \|\| \(incoming\(\)\.get\('status', 'active'\) == 'active' && incoming\(\)\.role == 'admin'\)/);
  assert.match(users, /allow delete: if isAdmin\(\) && isValidId\(userId\) && request\.auth\.uid != userId;/);
  assert.match(rules, /data\.course in \['REE', 'RME'\]/);
  assert.doesNotMatch(rules, /match \/admins\//);
});
