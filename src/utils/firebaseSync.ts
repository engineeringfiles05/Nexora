/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase.ts';
import { PRIVATE_QUESTION_FIELDS, hasPrivateFields, splitQuestion } from './answerKeys.ts';
import {
  Question,
  PdfSource,
  ExamResult,
  AuditLog,
} from '../types/index.ts';

import { isAdminEmail } from '../auth/roles.ts';

/** True for the site owner's address. Admin access also needs a verified sign-in: see auth/roles.ts. */
export function isUserAdmin(email?: string | null): boolean {
  return isAdminEmail(email);
}

/**
 * Writes need a signed-in user (see firestore.rules). In demo mode nobody is signed in, so
 * writes are skipped instead of being sent only to be rejected; the app keeps the data locally.
 */
export function isSignedIn(): boolean {
  return Boolean(auth.currentUser);
}

/**
 * Recursively strips undefined keys and values from objects and arrays so Firestore never rejects writes.
 */
export function sanitizeForFirestore<T>(val: T): T {
  if (val === null || val === undefined) {
    return val;
  }
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof val === 'object' && (val.constructor === Object || !val.constructor)) {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(val as Record<string, any>)) {
      if (value !== undefined) {
        clean[key] = sanitizeForFirestore(value);
      }
    }
    return clean as T;
  }
  return val;
}

/**
 * Seeds initial demo questions and PDF sources into Firestore if the questions collection is empty.
 */
export async function seedInitialFirestoreData(
  initialQuestions: Question[],
  initialPdfSources: PdfSource[],
  initialAuditLogs: AuditLog[]
): Promise<boolean> {
  const path = 'questions';
  try {
    const existingSnap = await getDocs(collection(db, path));
    if (!existingSnap.empty) {
      return false; // Already populated
    }

    const batch = writeBatch(db);

    // Seed questions: the answer goes to its own admin-only document (utils/answerKeys.ts).
    for (const q of initialQuestions) {
      const { publicDoc, key } = splitQuestion({ course: 'REE', ...q });
      batch.set(doc(db, 'questions', q.id), sanitizeForFirestore(publicDoc));
      batch.set(doc(db, 'questionKeys', q.id), sanitizeForFirestore(key));
    }

    // Seed PDF sources
    for (const pdf of initialPdfSources) {
      const ref = doc(db, 'pdfSources', pdf.id);
      batch.set(ref, sanitizeForFirestore({ course: 'REE', ...pdf }));
    }

    // Seed Audit logs
    for (const log of initialAuditLogs) {
      const ref = doc(db, 'auditLogs', log.id);
      batch.set(ref, sanitizeForFirestore(log));
    }

    await batch.commit();
    return true;
  } catch (error) {
    console.warn('Initial Firestore seed skipped or unpermitted:', error);
    return false;
  }
}

/**
 * Gives material created before courses existed the course "REE" (all of it was REE). Reviewees
 * only see material of their own course (firestore.rules), so this runs when the administrator
 * signs in. Only documents without a course are written; it does nothing once they all have one.
 */
export async function backfillContentCourse(): Promise<number> {
  let updated = 0;
  for (const name of ['questions', 'pdfSources'] as const) {
    const snapshot = await getDocs(collection(db, name));
    const missing = snapshot.docs.filter((d) => d.data().course !== 'REE' && d.data().course !== 'RME');
    for (let i = 0; i < missing.length; i += 400) {
      const batch = writeBatch(db);
      missing.slice(i, i + 400).forEach((d) => batch.update(d.ref, { course: 'REE' }));
      await batch.commit();
    }
    updated += missing.length;
  }
  return updated;
}

/**
 * Moves answers out of question documents written before answer keys existed: each one's
 * answer, explanation and solution go to `questionKeys/{id}` and are removed from the
 * question. Runs when the administrator signs in; does nothing once every question is split.
 */
export async function migrateAnswerKeys(): Promise<number> {
  const snapshot = await getDocs(collection(db, 'questions'));
  const pending = snapshot.docs.filter((d) => hasPrivateFields(d.data()));
  for (let i = 0; i < pending.length; i += 200) {
    const batch = writeBatch(db);
    for (const d of pending.slice(i, i + 200)) {
      const { key } = splitQuestion({ ...(d.data() as Question), id: d.id });
      batch.set(doc(db, 'questionKeys', d.id), sanitizeForFirestore(key), { merge: true });
      batch.update(d.ref, Object.fromEntries(PRIVATE_QUESTION_FIELDS.filter((f) => f in d.data()).map((f) => [f, deleteField()])));
    }
    await batch.commit();
  }
  return pending.length;
}

/**
 * Saves or updates a question in Firestore: the question itself, and its answer key in an
 * admin-only document, in one batch so they never disagree.
 */
export async function saveQuestionToFirestore(question: Question): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `questions/${question.id}`;
  try {
    const { publicDoc, key } = splitQuestion(question);
    const batch = writeBatch(db);
    batch.set(doc(db, 'questions', question.id), sanitizeForFirestore(publicDoc));
    batch.set(doc(db, 'questionKeys', question.id), sanitizeForFirestore(key));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes a question from Firestore
 */
export async function deleteQuestionFromFirestore(questionId: string): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `questions/${questionId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'questions', questionId));
    batch.delete(doc(db, 'questionKeys', questionId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Saves a list of questions in batch to Firestore with safety chunking (max 400 docs per batch)
 */
export async function batchSaveQuestionsToFirestore(questions: Question[]): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = 'questions';
  try {
    // Firestore allows 500 writes and 10 MiB per batch; figures can make documents large.
    const MAX_DOCS = 400;
    const MAX_BYTES = 8 * 1024 * 1024;
    let batch = writeBatch(db);
    let docs = 0;
    let bytes = 0;
    for (const q of questions) {
      const { publicDoc, key } = splitQuestion(q);
      const cleanQuestion = sanitizeForFirestore(publicDoc);
      const cleanKey = sanitizeForFirestore(key);
      const size = JSON.stringify(cleanQuestion).length + JSON.stringify(cleanKey).length;
      if (docs > 0 && (docs + 2 > MAX_DOCS || bytes + size > MAX_BYTES)) {
        await batch.commit();
        batch = writeBatch(db);
        docs = 0;
        bytes = 0;
      }
      batch.set(doc(db, 'questions', q.id), cleanQuestion);
      batch.set(doc(db, 'questionKeys', q.id), cleanKey);
      docs += 2;
      bytes += size;
    }
    if (docs > 0) await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Saves or updates a PDF source in Firestore
 */
export async function savePdfSourceToFirestore(source: PdfSource): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `pdfSources/${source.id}`;
  try {
    await setDoc(doc(db, 'pdfSources', source.id), sanitizeForFirestore(source));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes an uploaded PDF's record, and the given questions with their answer keys.
 * The PDF record goes in the last batch, so a failure part-way leaves it listed and retryable.
 */
export async function deletePdfSourceFromFirestore(sourceId: string, questionIds: string[]): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `pdfSources/${sourceId}`;
  try {
    const PER_BATCH = 200; // two deletes per question, under Firestore's 500 writes per batch
    for (let i = 0; i < questionIds.length; i += PER_BATCH) {
      const batch = writeBatch(db);
      for (const id of questionIds.slice(i, i + PER_BATCH)) {
        batch.delete(doc(db, 'questions', id));
        batch.delete(doc(db, 'questionKeys', id));
      }
      await batch.commit();
    }
    await deleteDoc(doc(db, 'pdfSources', sourceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Saves an exam result to Firestore
 */
export async function saveExamResultToFirestore(result: ExamResult): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `examResults/${result.id}`;
  try {
    await setDoc(doc(db, 'examResults', result.id), sanitizeForFirestore(result));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Saves an audit log entry to Firestore
 */
export async function saveAuditLogToFirestore(log: AuditLog): Promise<void> {
  if (!isSignedIn()) return; // demo mode: the data stays in this browser
  const path = `auditLogs/${log.id}`;
  try {
    await setDoc(doc(db, 'auditLogs', log.id), sanitizeForFirestore(log));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

