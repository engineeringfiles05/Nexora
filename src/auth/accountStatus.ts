/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Account status and course access: shared by the app and mirrored by firestore.rules,
 * which is what actually blocks inactive, suspended and pending accounts.
 */

import type { Course, UserProfile, UserStatus } from '../types/index.ts';

export const USER_STATUSES: UserStatus[] = ['pending', 'active', 'rejected', 'suspended', 'inactive'];

export const STATUS_LABELS: Record<UserStatus, string> = {
  pending: 'Pending approval',
  active: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  inactive: 'Deactivated',
};

/** Every account created by public registration starts here (firestore.rules enforces it). */
export const NEW_REGISTRATION_STATUS: UserStatus = 'pending';

/** Profiles written before statuses existed are active. */
export function statusOf(profile: Pick<UserProfile, 'status'> | null | undefined): UserStatus {
  const status = profile?.status;
  return status && (USER_STATUSES as string[]).includes(status) ? status : 'active';
}

export function canAccessPlatform(profile: Pick<UserProfile, 'status'> | null | undefined): boolean {
  return statusOf(profile) === 'active';
}

/** What a blocked person is told when they sign in (or are signed out). */
export function blockedMessage(profile: Pick<UserProfile, 'status' | 'statusReason'>): string {
  const reason = profile.statusReason?.trim() ? ` Reason: ${profile.statusReason.trim()}` : '';
  switch (statusOf(profile)) {
    case 'pending':
      return 'Your account is waiting for approval by the NEXORA Academy administrator. You can sign in once it has been approved.';
    case 'rejected':
      return `Your registration was not approved.${reason} Contact NEXORA Academy if you think this is a mistake.`;
    case 'suspended':
      return `Your account has been suspended.${reason} Contact NEXORA Academy if you think this is a mistake.`;
    case 'inactive':
      return `Your account has been deactivated.${reason} Contact NEXORA Academy to reactivate it.`;
    default:
      return '';
  }
}

/** Course of a question or question set. Material created before courses existed is REE. */
export function contentCourse(item: { course?: Course | null }): Course {
  return item.course === 'RME' ? 'RME' : 'REE';
}

