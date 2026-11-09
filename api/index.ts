/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Vercel Function serving every /api/* route (vercel.json rewrites them here). It runs the
// same Express app as server.ts, in serverless mode: see server/app.ts for what changes.

import { createApp } from '../server/app.ts';

export default createApp({ ...process.env, NEXORA_SERVERLESS: 'true' });
