/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form validation and sanitisation for sign-in and registration. The same limits are
 * enforced again by firestore.rules, so a modified client cannot store anything else.
 */

import type { Course } from '../types/index.ts';
import { isAdminEmail } from './roles.ts';

export const COURSES: { id: Course; name: string; description: string }[] = [
  { id: 'REE', name: 'REE', description: 'Registered Electrical Engineer' },
  { id: 'RME', name: 'RME', description: 'Registered Master Electrician' },
];

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const CONTACT_MAX = 20;

// Deliberately practical: one "@", a dot in the domain, no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length > 0 && value.length <= EMAIL_MAX && EMAIL_PATTERN.test(value);
}

/** Collapses whitespace and drops control characters and markup brackets. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** Keeps digits, one leading "+", spaces, dashes and brackets. */
export function sanitizeContact(contact: string): string {
  const trimmed = contact.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return (plus + trimmed.replace(/[^\d\s\-()]/g, '')).replace(/\s+/g, ' ').trim().slice(0, CONTACT_MAX);
}

export function isValidContact(contact: string): boolean {
  if (!contact) return true; // optional
  const digits = contact.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export interface PasswordStrength {
  /** 0 (empty) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong' | '';
  checks: { id: string; label: string; met: boolean }[];
}

export function passwordStrength(password: string): PasswordStrength {
  const checks = [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, met: password.length >= PASSWORD_MIN },
    { id: 'letter', label: 'Upper and lower case letters', met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { id: 'number', label: 'At least one number', met: /\d/.test(password) },
    { id: 'symbol', label: 'At least one symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];
  if (!password) return { score: 0, label: '', checks };
  if (password.length < PASSWORD_MIN) return { score: 1, label: 'Too short', checks };
  const met = checks.filter((c) => c.met).length + (password.length >= 12 ? 1 : 0);
  const score = (met >= 5 ? 4 : met >= 4 ? 3 : met >= 3 ? 2 : 1) as PasswordStrength['score'];
  const label = (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label, checks };
}

/** Minimum accepted: 8+ characters with at least one letter and one number. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  return null;
}

export interface RegistrationForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  course: Course | '';
  contactNumber: string;
  acceptedTerms: boolean;
}

export type RegistrationErrors = Partial<Record<keyof RegistrationForm, string>>;

export function validateRegistration(form: RegistrationForm): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const name = sanitizeName(form.name);
  if (!name) errors.name = 'Enter your complete name.';
  else if (name.length < 2) errors.name = 'Enter your complete name.';

  if (!form.email.trim()) errors.email = 'Enter your email address.';
  else if (!isValidEmail(form.email)) errors.email = 'Enter a valid email address, like name@example.com.';
  else if (isAdminEmail(form.email)) errors.email = 'This email address is reserved. Sign in instead.';

  const pw = passwordProblem(form.password);
  if (!form.password) errors.password = 'Create a password.';
  else if (pw) errors.password = pw;

  if (!form.confirmPassword) errors.confirmPassword = 'Confirm your password.';
  else if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match.';

  if (form.course !== 'REE' && form.course !== 'RME') errors.course = 'Choose the board exam you are reviewing for.';

  if (form.contactNumber.trim() && !isValidContact(sanitizeContact(form.contactNumber))) {
    errors.contactNumber = 'Enter a valid contact number, like 0917 123 4567.';
  }
  if (!form.acceptedTerms) errors.acceptedTerms = 'You need to accept the Terms and Conditions and Privacy Policy.';
  return errors;
}

export function validateLogin(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

/** Firebase Auth error codes as messages a reviewee can act on. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead, or reset your password.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a stronger password: at least 8 characters with letters and numbers.';
    case 'auth/too-many-requests':
      return 'Too many attempts. For your security, sign-in is paused for a while. Try again later or reset your password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact NEXORA Academy for help.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'This email is already registered with a different sign-in method. Sign in with your password.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet. Contact NEXORA Academy.';
    case 'auth/expired-action-code':
      return 'This reset link has expired. Request a new one.';
    case 'auth/invalid-action-code':
      return 'This reset link is invalid or has already been used. Request a new one.';
    case 'auth/requires-recent-login':
      return 'For your security, sign in again before making this change.';
    case 'auth/missing-password':
      return 'Enter your password.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Slows down repeated failed sign-ins in this browser. Firebase Auth applies its own
 * server-side throttling (auth/too-many-requests); this only stops rapid retries early.
 */
export function createLoginThrottle(options: { freeAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; now?: () => number } = {}) {
  const free = options.freeAttempts ?? 5;
  const base = options.baseDelayMs ?? 30_000;
  const max = options.maxDelayMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  let failures = 0;
  let lockedUntil = 0;
  return {
    /** Milliseconds until another attempt is allowed (0 = allowed now). */
    waitMs: () => Math.max(0, lockedUntil - now()),
    fail: () => {
      failures += 1;
      if (failures >= free) lockedUntil = now() + Math.min(max, base * 2 ** (failures - free));
    },
    succeed: () => {
      failures = 0;
      lockedUntil = 0;
    },
  };
}
