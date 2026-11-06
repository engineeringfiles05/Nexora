/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * Single-browser storage only: a refresh keeps changes, but nothing reaches other users
 * or devices. Shared data needs a server database and real sign-in.
 */
const STORAGE_PREFIX = 'nexora.v1.';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // storage can be blocked, for example by privacy settings
  }
}

export function loadPersisted<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  storage: StorageLike | null = getBrowserStorage()
): T {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function savePersisted(
  key: string,
  value: unknown,
  storage: StorageLike | null = getBrowserStorage()
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // for example, storage quota exceeded
  }
}

export function isRecordArray<T extends { id: string }>(value: unknown): value is T[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string')
  );
}

export function usePersistentState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  onSaved: (key: string, succeeded: boolean) => void
) {
  const [value, setValue] = useState<T>(() => loadPersisted(key, fallback, isValid));
  useEffect(() => {
    onSaved(key, savePersisted(key, value));
    // onSaved is only a status callback; saving depends on the value alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);
  return [value, setValue] as const;
}
