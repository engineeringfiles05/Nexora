/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Firestore storage of import sessions: `importSessions/{sessionId}` holds the session and
 * `importSessions/{sessionId}/drafts/{questionId}` each draft question. firestore.rules lets
 * only the verified administrator read or write them. Drafts are never visible to reviewees:
 * they only reach the `questions` collection when the administrator publishes them.
 */

import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.ts';
import type { Question } from '../types/index.ts';
import { sanitizeForFirestore } from './firebaseSync.ts';
import type { ImportSession } from './importSessions.ts';

const SESSIONS = 'importSessions';

export async function listSessions(max = 50): Promise<ImportSession[]> {
  const snapshot = await getDocs(query(collection(db, SESSIONS), orderBy('createdAt', 'desc'), limit(max)));
  return snapshot.docs.map((d) => d.data() as ImportSession);
}

export async function saveSession(session: ImportSession): Promise<void> {
  await setDoc(doc(db, SESSIONS, session.id), sanitizeForFirestore(session));
}

export async function loadDrafts(session: ImportSession): Promise<Question[]> {
  const snapshot = await getDocs(collection(db, SESSIONS, session.id, 'drafts'));
  const byId = new Map(snapshot.docs.map((d) => [d.id, d.data() as Question]));
  const ordered = session.draftOrder.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
  // Anything not in the order (should not happen) is kept at the end rather than lost.
  for (const [id, q] of byId) if (!session.draftOrder.includes(id)) ordered.push(q);
  return ordered;
}

/** Writes drafts in batches (Firestore allows 500 writes and 10 MiB per batch). */
export async function saveDrafts(sessionId: string, drafts: Question[], remove: string[] = []): Promise<void> {
  const MAX_DOCS = 400;
  const MAX_BYTES = 8 * 1024 * 1024;
  let batch = writeBatch(db);
  let docs = 0;
  let bytes = 0;
  const flush = async () => {
    if (docs > 0) await batch.commit();
    batch = writeBatch(db);
    docs = 0;
    bytes = 0;
  };
  for (const id of remove) {
    if (docs >= MAX_DOCS) await flush();
    batch.delete(doc(db, SESSIONS, sessionId, 'drafts', id));
    docs++;
  }
  for (const q of drafts) {
    const clean = sanitizeForFirestore(q);
    const size = JSON.stringify(clean).length;
    if (docs > 0 && (docs >= MAX_DOCS || bytes + size > MAX_BYTES)) await flush();
    batch.set(doc(db, SESSIONS, sessionId, 'drafts', q.id), clean);
    docs++;
    bytes += size;
  }
  await flush();
}

export async function deleteSession(session: ImportSession): Promise<void> {
  const snapshot = await getDocs(collection(db, SESSIONS, session.id, 'drafts'));
  await saveDrafts(session.id, [], snapshot.docs.map((d) => d.id));
  await deleteDoc(doc(db, SESSIONS, session.id));
}
