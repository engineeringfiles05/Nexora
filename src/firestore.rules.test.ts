/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isUserAdmin } from './utils/firebaseSync.ts';
import { OperationType, handleFirestoreError } from './firebase.ts';

test('isUserAdmin only approves authorized bootstrapped admin email', () => {
  assert.equal(isUserAdmin('engineeringfiles05@gmail.com'), true);
  assert.equal(isUserAdmin('ENGINEERINGFILES05@GMAIL.COM'), true);
  assert.equal(isUserAdmin('attacker@example.com'), false);
  assert.equal(isUserAdmin(''), false);
  assert.equal(isUserAdmin(null), false);
  assert.equal(isUserAdmin(undefined), false);
});

test('handleFirestoreError formats structured FirestoreErrorInfo JSON', () => {
  let thrownError: Error | null = null;
  try {
    handleFirestoreError(new Error('Missing or insufficient permissions'), OperationType.WRITE, 'questions/q1');
  } catch (err: any) {
    thrownError = err;
  }

  assert.ok(thrownError, 'An error must be thrown');
  const parsed = JSON.parse(thrownError.message);
  assert.equal(parsed.operationType, OperationType.WRITE);
  assert.equal(parsed.path, 'questions/q1');
  assert.ok(parsed.error.includes('insufficient permissions'));
});

test('Security Rules Invariants: ID validation regex matches only clean alphanumeric IDs', () => {
  const isValidId = (id: string) =>
    typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);

  assert.equal(isValidId('math-001'), true);
  assert.equal(isValidId('user_12345'), true);
  assert.equal(isValidId('exam-res-99'), true);

  // Dirty Dozen ID Poisoning checks
  assert.equal(isValidId(''), false, 'Empty ID rejected');
  assert.equal(isValidId('../parent/escape'), false, 'Path traversal rejected');
  assert.equal(isValidId('malicious/subcollection'), false, 'Slash rejected');
  assert.equal(isValidId('q?id=1&inject=true'), false, 'Query characters rejected');
  assert.equal(isValidId('a'.repeat(129)), false, 'Overlength ID rejected');
});
