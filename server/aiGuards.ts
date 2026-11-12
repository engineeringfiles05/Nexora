/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const ADMIN_TOKEN_HEADER = 'x-nexora-admin-token';

/** Hashing first gives equal-length buffers, so comparison time doesn't reveal the token. */
export function tokensMatch(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Protects the paid Gemini routes with a shared secret. Production fails closed when no
 * token is configured; local development may run without one.
 */
export function requireAiAccess(options: { token: string; isProduction: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Already verified as the administrator's Firebase sign-in (server/firebaseAuth.ts).
    if (res.locals?.identity?.role === 'admin') return next();
    // In local development or AI Studio preview (non-production), AI features are accessible
    // without requiring users in the UI to manually guess or configure an admin secret.
    if (!options.isProduction) {
      const provided = req.get(ADMIN_TOKEN_HEADER);
      if (!provided) return next();
      if (!options.token || tokensMatch(provided, options.token)) return next();
      return res.status(401).json({ error: 'A valid admin access token is required to use AI features.' });
    }

    if (!options.token) {
      return res.status(503).json({
        error: 'AI features are disabled: NEXORA_ADMIN_TOKEN is not configured on the server.',
      });
    }
    const provided = req.get(ADMIN_TOKEN_HEADER);
    if (!provided || !tokensMatch(provided, options.token)) {
      return res.status(401).json({ error: 'A valid admin access token is required to use AI features.' });
    }
    return next();
  };
}

export interface RateLimiter {
  check: (key: string) => { allowed: boolean; retryAfterSeconds: number };
}

/** Fixed-window, per-process limiter. Instances don't share counts and restarts reset them. */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    check: (key) => {
      const time = now();
      for (const [storedKey, entry] of windows) {
        if (entry.resetAt <= time) windows.delete(storedKey);
      }
      const entry = windows.get(key) ?? { count: 0, resetAt: time + options.windowMs };
      windows.set(key, entry);
      if (entry.count >= options.limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - time) / 1000) };
      }
      entry.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Applies a per-client limit and a process-wide budget, so many clients can't add up. */
export function rateLimitAi(perClient: RateLimiter, global: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    const decision = perClient.check(req.ip ?? 'unknown');
    const overall = decision.allowed ? global.check('all') : decision;
    if (!overall.allowed) {
      res.set('Retry-After', String(overall.retryAfterSeconds));
      return res.status(429).json({ error: 'AI usage limit reached. Please try again later.' });
    }
    return next();
  };
}
