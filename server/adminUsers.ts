/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin-only account routes. Every request must carry the verified administrator's Firebase
 * ID token (server/firebaseAuth.ts): no token is 401, a reviewee's token is 403. The
 * administrator can't use them on their own account.
 *
 *   GET    /api/admin/capabilities      { serviceAccount }
 *   PATCH  /api/admin/users/:uid        { email?, disabled? }  sign-in email / block sign-in
 *   DELETE /api/admin/users/:uid        delete the Firebase Auth account
 *
 * Profile details, status and course live in Firestore and are written by the app under
 * firestore.rules; these routes cover what only Firebase Admin credentials can do.
 */

import express from 'express';
import { isValidEmail, normalizeEmail } from '../src/auth/validation.ts';
import { isAdminEmail } from '../src/auth/roles.ts';
import type { RateLimiter } from './aiGuards.ts';
import { AuthAdminError, type AuthAdmin } from './googleAdmin.ts';
import type { VerifiedIdentity } from './firebaseAuth.ts';

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function adminUserRoutes(options: {
  identityGate: express.RequestHandler;
  authAdmin: AuthAdmin | null;
  limiter: RateLimiter;
}) {
  const router = express.Router();

  // Signed-in administrator only: unlike the AI routes there is no shared-token fallback.
  router.use((req, res, next) => {
    if (!/^Bearer\s+\S+$/i.test(req.get('authorization') ?? '')) {
      return res.status(401).json({ error: 'Sign in as the administrator to manage accounts.' });
    }
    return options.identityGate(req, res, next);
  });
  router.use((req, res, next) => {
    const identity = res.locals.identity as VerifiedIdentity | undefined;
    if (identity?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
    const decision = options.limiter.check(identity.uid);
    if (!decision.allowed) {
      res.set('Retry-After', String(decision.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many account changes in a short time. Please wait and try again.' });
    }
    return next();
  });

  router.get('/capabilities', (_req, res) => res.json({ serviceAccount: Boolean(options.authAdmin) }));

  const target = (req: express.Request, res: express.Response): string | null => {
    const uid = String(req.params.uid ?? '');
    if (!UID_PATTERN.test(uid)) {
      res.status(400).json({ error: 'Invalid account id.' });
      return null;
    }
    if (uid === (res.locals.identity as VerifiedIdentity).uid) {
      res.status(400).json({ error: 'You cannot change or delete your own administrator account here.' });
      return null;
    }
    if (!options.authAdmin) {
      res.status(503).json({
        error: 'This needs Firebase Admin credentials on the server. Set FIREBASE_SERVICE_ACCOUNT (see .env.example) and redeploy.',
        code: 'SERVICE_ACCOUNT_MISSING',
      });
      return null;
    }
    return uid;
  };

  const fail = (res: express.Response, error: unknown) => {
    if (error instanceof AuthAdminError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[Admin users] Unexpected error:', error);
    return res.status(500).json({ error: 'The account could not be changed.' });
  };

  router.patch('/users/:uid', express.json({ limit: '10kb' }), async (req, res) => {
    const uid = target(req, res);
    if (!uid) return;
    const { email, disabled } = req.body ?? {};
    if (email === undefined && disabled === undefined) return res.status(400).json({ error: 'Nothing to change.' });
    if (email !== undefined && (typeof email !== 'string' || !isValidEmail(email))) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof email === 'string' && isAdminEmail(email)) return res.status(400).json({ error: 'This email address is reserved.' });
    if (disabled !== undefined && typeof disabled !== 'boolean') return res.status(400).json({ error: '"disabled" must be true or false.' });
    try {
      await options.authAdmin!.updateUser(uid, { ...(email ? { email: normalizeEmail(email) } : {}), ...(typeof disabled === 'boolean' ? { disabled } : {}) });
      return res.json({ ok: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.delete('/users/:uid', async (req, res) => {
    const uid = target(req, res);
    if (!uid) return;
    try {
      const { existed } = await options.authAdmin!.deleteUser(uid);
      return res.json({ ok: true, existed });
    } catch (error) {
      return fail(res, error);
    }
  });

  return router;
}
