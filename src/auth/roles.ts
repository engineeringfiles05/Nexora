/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Who is an administrator. Shared by the web app and the API server, and mirrored by
 * isAdmin() in firestore.rules, which is what actually protects the data.
 *
 * Only the site owner's account is an administrator, and only once Firebase has verified
 * that the account really owns that address (Google sign-in always does). Every other
 * account, including every account created through public registration, is a reviewee.
 * A role stored in a user's profile document is never trusted: it is display data only.
 */

import type { UserRole } from '../types/index.ts';

export const ADMIN_EMAIL = 'engineeringfiles05@gmail.com';

/** The Firebase project the ID tokens are issued for (see firebase-applet-config.json). */
export const FIREBASE_PROJECT_ID = 'gen-lang-client-0457110273';

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/** The role an authenticated identity has. Unverified addresses are never administrators. */
export function roleForIdentity(identity: { email?: string | null; emailVerified?: boolean | null }): UserRole {
  return isAdminEmail(identity.email) && identity.emailVerified === true ? 'admin' : 'reviewee';
}
