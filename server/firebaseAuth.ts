/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side check of the signed-in account behind an API request.
 *
 * The browser sends its Firebase ID token as "Authorization: Bearer <token>". It is verified
 * the way Firebase documents for third-party JWT libraries: RS256 signature against Google's
 * published securetoken certificates, audience and issuer for this project, unexpired, with
 * a subject. Only then is the administrator rule applied (src/auth/roles.ts), so a reviewee,
 * or anyone holding a forged or expired token, cannot use the admin APIs.
 */

import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { FIREBASE_PROJECT_ID, roleForIdentity } from '../src/auth/roles.ts';

export const SECURETOKEN_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  role: 'admin' | 'reviewee';
}

export class IdTokenError extends Error {}

export type CertificateSource = () => Promise<Record<string, string>>;

/** Google's certificates, cached for as long as their Cache-Control allows. */
export function googleCertificates(fetcher: typeof fetch = fetch, now: () => number = Date.now): CertificateSource {
  let cached: { certs: Record<string, string>; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt > now()) return cached.certs;
    const res = await fetcher(SECURETOKEN_CERTS_URL);
    if (!res.ok) throw new IdTokenError('Could not load the sign-in verification certificates.');
    const certs = (await res.json()) as Record<string, string>;
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    cached = { certs, expiresAt: now() + maxAge * 1000 };
    return certs;
  };
}

function decodeSegment(segment: string): any {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new IdTokenError('Malformed token.');
  }
}

const keyCache = new Map<string, KeyObject>();

export async function verifyIdToken(
  token: string,
  options: { projectId?: string; certificates: CertificateSource; now?: () => number }
): Promise<VerifiedIdentity> {
  const projectId = options.projectId ?? FIREBASE_PROJECT_ID;
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  const parts = token.split('.');
  if (parts.length !== 3) throw new IdTokenError('Malformed token.');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeSegment(headerPart);
  const payload = decodeSegment(payloadPart);

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new IdTokenError('Unexpected token algorithm.');
  const certs = await options.certificates();
  const pem = certs[header.kid];
  if (!pem) throw new IdTokenError('Token signed with an unknown key.');
  let key = keyCache.get(pem);
  if (!key) {
    key = createPublicKey(pem);
    keyCache.set(pem, key);
  }
  const signed = verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'));
  if (!signed) throw new IdTokenError('Invalid token signature.');

  const skew = 60; // seconds of clock difference tolerated
  if (payload.aud !== projectId) throw new IdTokenError('Token is for another project.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new IdTokenError('Token has the wrong issuer.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new IdTokenError('Token has no subject.');
  if (typeof payload.exp !== 'number' || payload.exp + skew <= nowSeconds) throw new IdTokenError('Token has expired.');
  if (typeof payload.iat !== 'number' || payload.iat - skew > nowSeconds) throw new IdTokenError('Token issued in the future.');
  if (typeof payload.auth_time !== 'number' || payload.auth_time - skew > nowSeconds) throw new IdTokenError('Token has an invalid sign-in time.');

  const email = typeof payload.email === 'string' ? payload.email : null;
  const emailVerified = payload.email_verified === true;
  return { uid: payload.sub, email, emailVerified, role: roleForIdentity({ email, emailVerified }) };
}

export function bearerToken(req: Pick<Request, 'get'>): string | null {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

/**
 * When a request carries a Firebase ID token: lets the verified administrator through,
 * refuses everyone else (401 for a bad token, 403 for a reviewee). Requests without one go
 * on to the next check (the admin access token).
 */
export function adminIdentityGate(options: { certificates: CertificateSource; projectId?: string; now?: () => number }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) return next();
    let identity: VerifiedIdentity;
    try {
      identity = await verifyIdToken(token, options);
    } catch (error) {
      if (!(error instanceof IdTokenError)) console.error('[Auth] ID token check failed:', error);
      return res.status(401).json({ error: 'Your sign-in could not be verified. Sign in again and retry.' });
    }
    if (identity.role !== 'admin') {
      return res.status(403).json({ error: 'This feature is only available to the NEXORA Academy administrator.' });
    }
    res.locals.identity = identity;
    return next();
  };
}
