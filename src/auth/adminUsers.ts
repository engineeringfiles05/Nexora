/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account management for the administrator. Every write here is checked again by
 * firestore.rules (isAdmin()), and the Auth-level operations by the API (server/adminUsers.ts),
 * so none of it works for anyone but the verified site owner.
 *
 * - Profile details, course access and account status live in `users/{uid}`, the same
 *   documents the app already reads. A status other than "active" blocks the account at once:
 *   the rules stop it reading materials and saving results, and its open sessions sign out.
 * - Accounts are created as Firebase Auth accounts through a separate, in-memory Firebase app
 *   instance, so the administrator stays signed in. The new reviewee chooses their own
 *   password from an emailed, expiring link; the temporary one is random and never shown.
 * - Changing a sign-in email, blocking sign-in at the Auth level and permanently deleting an
 *   Auth account need Firebase Admin credentials, so they go through the API.
 */

import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, inMemoryPersistence, sendPasswordResetEmail, setPersistence, signOut } from 'firebase/auth';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db } from '../firebase.ts';
import { sanitizeForFirestore } from '../utils/firebaseSync.ts';
import type { Course, UserProfile, UserStatus } from '../types/index.ts';
import { continueSettings, courseDetails } from './authService.ts';
import { isAdminEmail } from './roles.ts';
import { normalizeEmail, sanitizeContact, sanitizeName } from './validation.ts';

const PROVISIONING_APP = 'nexora-account-provisioning';

function provisioningAuth() {
  const app = getApps().find((a) => a.name === PROVISIONING_APP) ?? initializeApp(firebaseConfig, PROVISIONING_APP);
  return getAuth(app);
}

/** 32 random characters plus one of each class, so any Firebase password policy accepts it. */
export function temporaryPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const random = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '');
  return `${random}Aa1!`;
}

async function sendSetupEmail(email: string) {
  try {
    await sendPasswordResetEmail(auth, email, continueSettings());
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== 'auth/unauthorized-continue-uri' && code !== 'auth/invalid-continue-uri') throw error;
    await sendPasswordResetEmail(auth, email);
  }
}

export interface NewAccount {
  name: string;
  email: string;
  course: Course;
  contactNumber?: string;
}

export interface CreatedAccount {
  profile: UserProfile;
  /** False when the account exists but the password email could not be sent (resend it). */
  setupEmailSent: boolean;
}

/** Creates a reviewee account. Firebase refuses an email that is already registered. */
export async function createReviewee(details: NewAccount, adminUid: string): Promise<CreatedAccount> {
  const email = normalizeEmail(details.email);
  if (isAdminEmail(email)) throw Object.assign(new Error('Reserved address'), { code: 'auth/email-already-in-use' });
  const provisioning = provisioningAuth();
  await setPersistence(provisioning, inMemoryPersistence);
  const credential = await createUserWithEmailAndPassword(provisioning, email, temporaryPassword());
  const uid = credential.user.uid;
  await signOut(provisioning).catch(() => {});

  const now = new Date().toISOString();
  const courseInfo = courseDetails(details.course);
  const contactNumber = details.contactNumber ? sanitizeContact(details.contactNumber) : '';
  const profile: UserProfile = {
    id: uid,
    name: sanitizeName(details.name),
    email,
    role: 'reviewee',
    avatar: '',
    title: courseInfo.title,
    targetExam: courseInfo.targetExam,
    enrolledAt: now,
    updatedAt: now,
    course: details.course,
    ...(contactNumber ? { contactNumber } : {}),
    authProvider: 'password',
    status: 'active',
    createdBy: adminUid,
  };
  await setDoc(doc(db, 'users', uid), sanitizeForFirestore(profile));
  let setupEmailSent = true;
  await sendSetupEmail(email).catch((err) => {
    console.warn('Password setup email failed:', err);
    setupEmailSent = false;
  });
  return { profile, setupEmailSent };
}

export function resendSetupEmail(email: string): Promise<void> {
  return sendSetupEmail(normalizeEmail(email));
}

export interface ProfileChanges {
  name: string;
  /** null removes course access. */
  course: Course | null;
  contactNumber: string;
  email?: string;
}

export async function updateRevieweeProfile(uid: string, changes: ProfileChanges): Promise<void> {
  const info = courseDetails(changes.course);
  const update: Record<string, unknown> = {
    name: sanitizeName(changes.name),
    contactNumber: sanitizeContact(changes.contactNumber),
    course: changes.course,
    title: info.title,
    targetExam: info.targetExam ?? deleteField(),
    updatedAt: new Date().toISOString(),
  };
  if (changes.email) update.email = normalizeEmail(changes.email);
  await updateDoc(doc(db, 'users', uid), update);
}

export async function setAccountStatus(uid: string, status: UserStatus, reason?: string): Promise<void> {
  const trimmed = reason?.trim().slice(0, 300);
  await updateDoc(doc(db, 'users', uid), {
    status,
    statusReason: status !== 'active' && trimmed ? trimmed : deleteField(),
    statusChangedAt: new Date().toISOString(),
  });
}

/** Removes the account's Firestore records: its exam results, then its profile. */
export async function deleteAccountRecords(uid: string): Promise<{ resultsDeleted: number }> {
  const results = await getDocs(query(collection(db, 'examResults'), where('userId', '==', uid)));
  let deleted = 0;
  for (let i = 0; i < results.docs.length; i += 400) {
    const batch = writeBatch(db);
    results.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(400, results.docs.length - i);
  }
  await deleteDoc(doc(db, 'users', uid));
  return { resultsDeleted: deleted };
}

/** Reads the account's profile again (the "check approval status" button). */
export async function fetchProfile(uid: string): Promise<Partial<UserProfile> | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? (snapshot.data() as Partial<UserProfile>) : null;
}
