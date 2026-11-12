/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account operations on Firebase Authentication (which stores and hashes passwords; the app
 * never sees or keeps them) and the matching profile document in Firestore `users/{uid}`.
 */

import {
  EmailAuthProvider,
  applyActionCode,
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  verifyPasswordResetCode,
  type ActionCodeSettings,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase.ts';
import { sanitizeForFirestore } from '../utils/firebaseSync.ts';
import type { Course, UserProfile, UserRole } from '../types/index.ts';
import { roleForIdentity } from './roles.ts';
import { normalizeEmail, sanitizeContact, sanitizeName } from './validation.ts';
import { writeRememberPreference } from './sessionPolicy.ts';

const COURSE_DETAILS: Record<Course, { title: string; targetExam: string }> = {
  REE: { title: 'REE Licensure Candidate', targetExam: 'Registered Electrical Engineer (REE) Licensure Examination' },
  RME: { title: 'RME Licensure Candidate', targetExam: 'Registered Master Electrician (RME) Licensure Examination' },
};

export function courseDetails(course: Course | undefined) {
  return course ? COURSE_DETAILS[course] : { title: 'Board Exam Reviewee', targetExam: undefined };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface PendingRegistration {
  email: string;
  name: string;
  course: Course;
  contactNumber?: string;
}

/** Details from the registration form, used when the new account's profile is created. */
let pendingRegistration: PendingRegistration | null = null;
const profileRequests = new Map<string, Promise<UserProfile>>();

function providerOf(user: User): string {
  return user.providerData[0]?.providerId ?? 'password';
}

/** The profile shown in the app: stored details, with the role always from the verified sign-in. */
export function buildProfile(user: Pick<User, 'uid' | 'email' | 'emailVerified' | 'displayName' | 'photoURL'>, stored: Partial<UserProfile> | null, provider = 'password'): UserProfile {
  const role: UserRole = roleForIdentity(user);
  const course = stored?.course;
  const details = courseDetails(course);
  return {
    id: user.uid,
    name: stored?.name || user.displayName || user.email?.split('@')[0] || 'Reviewee',
    email: user.email || stored?.email || '',
    role,
    avatar: user.photoURL || stored?.avatar || '',
    title: role === 'admin' ? 'Board Review Director' : details.title,
    targetExam: role === 'admin' ? undefined : stored?.targetExam || details.targetExam,
    enrolledAt: stored?.enrolledAt || new Date().toISOString(),
    ...(course ? { course } : {}),
    ...(stored?.contactNumber ? { contactNumber: stored.contactNumber } : {}),
    authProvider: stored?.authProvider || provider,
  };
}

/**
 * Loads the account's profile, creating it on first sign-in. Concurrent calls for the same
 * account (the auth listener and the registration form) share one request, so the profile
 * is written once, with the registration details.
 */
export function ensureProfile(user: User): Promise<UserProfile> {
  const existing = profileRequests.get(user.uid);
  if (existing) return existing;
  const request = loadOrCreateProfile(user).finally(() => {
    // Keep the result only briefly: later sign-ins should read fresh data.
    setTimeout(() => profileRequests.delete(user.uid), 5_000);
  });
  profileRequests.set(user.uid, request);
  return request;
}

async function loadOrCreateProfile(user: User): Promise<UserProfile> {
  const ref = doc(db, 'users', user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return buildProfile(user, snapshot.data() as Partial<UserProfile>, providerOf(user));

  const pending = pendingRegistration && user.email && normalizeEmail(user.email) === pendingRegistration.email ? pendingRegistration : null;
  const details = courseDetails(pending?.course);
  const profile = buildProfile(
    user,
    pending
      ? { name: pending.name, course: pending.course, contactNumber: pending.contactNumber, targetExam: details.targetExam }
      : null,
    providerOf(user)
  );
  const now = new Date().toISOString();
  // firestore.rules only accepts role "reviewee" here, except for the verified site owner.
  await setDoc(ref, sanitizeForFirestore({ ...profile, enrolledAt: now, updatedAt: now }));
  return { ...profile, enrolledAt: now, updatedAt: now };
}

export async function updateAccountDetails(user: User, changes: { name: string; course?: Course; contactNumber: string }): Promise<UserProfile> {
  const name = sanitizeName(changes.name);
  const contactNumber = sanitizeContact(changes.contactNumber);
  const details = courseDetails(changes.course);
  const role = roleForIdentity(user);
  const update: Record<string, unknown> = {
    name,
    role, // never anything but the verified role; the rules reject "admin" for everyone else
    contactNumber,
    updatedAt: new Date().toISOString(),
  };
  if (changes.course) {
    update.course = changes.course;
    update.targetExam = details.targetExam;
    update.title = details.title;
  }
  await updateDoc(doc(db, 'users', user.uid), update);
  if (name && name !== user.displayName) await updateProfile(user, { displayName: name }).catch(() => {});
  profileRequests.delete(user.uid);
  return ensureProfile(user);
}

// ---------------------------------------------------------------------------
// Sign-in, registration, sign-out
// ---------------------------------------------------------------------------

async function applyPersistence(remember: boolean) {
  writeRememberPreference(remember);
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

export async function signInWithPassword(email: string, password: string, remember: boolean): Promise<User> {
  await applyPersistence(remember);
  const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  return credential.user;
}

export async function signInWithGoogle(remember: boolean): Promise<User> {
  await applyPersistence(remember);
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export interface RegistrationDetails {
  name: string;
  email: string;
  password: string;
  course: Course;
  contactNumber?: string;
}

/**
 * Creates the account (Firebase rejects an email that is already registered), signs it in,
 * and stores its profile with the reviewee role. Nobody can choose their own role.
 */
export async function registerAccount(details: RegistrationDetails, remember: boolean): Promise<UserProfile> {
  const email = normalizeEmail(details.email);
  const name = sanitizeName(details.name);
  const contactNumber = details.contactNumber ? sanitizeContact(details.contactNumber) : undefined;
  await applyPersistence(remember);
  pendingRegistration = { email, name, course: details.course, ...(contactNumber ? { contactNumber } : {}) };
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, details.password);
    await updateProfile(credential.user, { displayName: name }).catch(() => {});
    const profile = await ensureProfile(credential.user);
    sendEmailVerification(credential.user, continueSettings()).catch(() => sendEmailVerification(credential.user).catch(() => {}));
    return profile;
  } finally {
    pendingRegistration = null;
  }
}

export async function resendVerificationEmail(user: User): Promise<void> {
  try {
    await sendEmailVerification(user, continueSettings());
  } catch (error) {
    if ((error as { code?: string })?.code !== 'auth/unauthorized-continue-uri') throw error;
    await sendEmailVerification(user);
  }
}

export async function signOutEverywhere(): Promise<void> {
  profileRequests.clear();
  await signOut(auth);
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

/** After using an email link, people come back to the sign-in page. */
function continueSettings(): ActionCodeSettings | undefined {
  if (typeof window === 'undefined') return undefined;
  return { url: `${window.location.origin}/login`, handleCodeInApp: false };
}

/**
 * Sends Firebase's password reset email. The link is single-use and expires (one hour by
 * default). For privacy the caller shows the same message whether or not the address is
 * registered.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const address = normalizeEmail(email);
  try {
    await sendPasswordResetEmail(auth, address, continueSettings());
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'auth/user-not-found') return; // same answer as for a registered address
    // This domain isn't in Firebase's authorised list yet: send the link without a return address.
    if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
      await sendPasswordResetEmail(auth, address);
      return;
    }
    throw error;
  }
}

/** Checks a reset link's code and returns the account email it belongs to. */
export function checkResetCode(code: string): Promise<string> {
  return verifyPasswordResetCode(auth, code);
}

export function completePasswordReset(code: string, newPassword: string): Promise<void> {
  return confirmPasswordReset(auth, code, newPassword);
}

/** Confirms an email address from a verification link pointed at /auth/action. */
export async function confirmEmailVerification(code: string): Promise<void> {
  await applyActionCode(auth, code);
  await auth.currentUser?.reload().catch(() => {});
}

export async function changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
  if (!user.email) throw Object.assign(new Error('No email on this account.'), { code: 'auth/invalid-email' });
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
}

export async function sessionStartedAt(user: User): Promise<number> {
  try {
    const token = await user.getIdTokenResult();
    return Date.parse(token.authTime);
  } catch {
    return NaN;
  }
}
