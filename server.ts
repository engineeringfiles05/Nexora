/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Long-running Node server: the API from server/app.ts plus the web app (Vite in
// development, the built files in production). On Vercel, api/index.ts serves the API instead.

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './server/app.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const app = createApp(process.env);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    // Vite's live-reload socket defaults to port 24678 for every dev server, so two servers
    // (say on 3000 and 3340) fight over it and the loser keeps reloading. Derive it from PORT.
    // (DISABLE_HMR is still honoured by vite.config.ts.)
    const ws = { port: Number(process.env.HMR_PORT) || PORT + 20000 };
    const vite = await createViteServer({ server: { middlewareMode: true, ws }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NEXORA ACADEMY] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Error]:', err);
});
