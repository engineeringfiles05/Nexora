/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How long a sign-in lasts.
 *
 * Firebase Auth keeps the session itself: short-lived ID tokens (one hour) refreshed
 * automatically, stored for this tab only ("Remember me" off) or across browser restarts
 * ("Remember me" on). On top of that:
 * - a remembered sign-in expires after 30 days, then the person signs in again;
 * - an unremembered sign-in expires after 12 hours, or after 30 minutes without activity
 *   (never in the middle of an exam).
 * Only the "Remember me" choice is kept in browser storage: it holds no credentials.
 */

export const REMEMBER_KEY = 'nexora.auth.remember';
export const REMEMBERED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function readRememberPreference(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(REMEMBER_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeRememberPreference(remember: boolean, storage: Pick<Storage, 'setItem'> | null = safeLocalStorage()) {
  try {
    storage?.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
  } catch {
    // Storage blocked: the sign-in simply isn't remembered.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True when a sign-in made at `authTimeMs` is older than allowed. */
export function isSessionExpired(authTimeMs: number, remember: boolean, now: number = Date.now()): boolean {
  if (!Number.isFinite(authTimeMs) || authTimeMs <= 0) return false; // unknown: let Firebase decide
  return now - authTimeMs > (remember ? REMEMBERED_MAX_AGE_MS : SESSION_MAX_AGE_MS);
}

/** True when an unremembered session has been idle too long. */
export function isIdleExpired(lastActivityMs: number, remember: boolean, inExam: boolean, now: number = Date.now()): boolean {
  if (remember || inExam) return false;
  return now - lastActivityMs > IDLE_TIMEOUT_MS;
}
