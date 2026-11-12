/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeps uploaded questionnaire files in this browser (IndexedDB), keyed by import session, so
 * the PDF can still be previewed beside its questions after a refresh, and an interrupted
 * import can be retried without choosing the file again. Extracted questions themselves are
 * saved in Firestore (utils/importPersistence.ts); this cache is only a convenience and every
 * caller copes with it being empty or unavailable (private windows, blocked storage).
 */

const DB_NAME = 'nexora-import-files';
const STORE = 'files';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(undefined);
    }
  });
}

export async function cacheFile(sessionId: string, file: File): Promise<boolean> {
  const saved = await run('readwrite', (s) => s.put({ name: file.name, type: file.type, data: file }, sessionId));
  return saved !== undefined;
}

export async function cachedFile(sessionId: string): Promise<File | null> {
  const entry = (await run('readonly', (s) => s.get(sessionId))) as { name: string; type: string; data: Blob } | undefined;
  if (!entry?.data) return null;
  return entry.data instanceof File ? entry.data : new File([entry.data], entry.name, { type: entry.type });
}

export async function forgetFile(sessionId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(sessionId));
}
