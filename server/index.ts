/**
 * Server entrypoint.
 *
 * Both surfaces share one process and one port: the CLI-facing gateway under
 * /v1 and /v1beta, and the dashboard's management API under /api. A single
 * port means one URL to configure and one thing to keep running.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { LogStore } from './db/logs.js';
import { SettingsStore } from './db/settings.js';
import { AccountPool } from './core/pool.js';
import { RouterCore } from './core/router.js';
import { createGateway } from './gateway/index.js';
import { createManagementApi } from './management/routes.js';
import { log, setLogLevel } from './core/logger.js';

setLogLevel(config.logLevel);

const db = openDatabase(config.databasePath);
const logs = new LogStore(db);
const settings = new SettingsStore(db);
const pool = new AccountPool(db, config.encryptionKey);
const core = new RouterCore(pool, settings, logs);

const app = express();
app.disable('x-powered-by');

// The dashboard runs on Vite's port during development, so its origin needs an
// explicit allowance. In production it is served from this same origin and the
// header is simply unused.
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin === config.devOrigin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptimeMs: core.uptimeMs });
});

app.use(
  '/api',
  createManagementApi({
    pool,
    core,
    logs,
    settings,
    endpointBaseUrl: config.publicBaseUrl,
    localToken: config.localToken,
  }),
);

app.use(createGateway({ core, pool, localToken: config.localToken }));

// Serve the built dashboard when one exists, so a single `npm start` gives a
// working UI without the Vite dev server.
const distDir = path.join(config.projectRoot, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const server = app.listen(config.port, config.host, () => {
  log.info('router listening', {
    endpoint: config.publicBaseUrl,
    openai: `${config.publicBaseUrl}/v1`,
    gemini: `${config.publicBaseUrl}/v1beta`,
    accounts: pool.all().length,
  });
  // Printed rather than logged as fields so the whole setup is easy to copy
  // out of a terminal on first run.
  process.stdout.write(
    [
      '',
      '  Local token:',
      `    ${config.localToken}`,
      '',
      '  Antigravity CLI — ~/.gemini/antigravity-cli/settings.json:',
      '    { "modelProvider": "gemini" }',
      '',
      '  Antigravity CLI — environment:',
      `    GOOGLE_GEMINI_BASE_URL=${config.publicBaseUrl}`,
      `    GEMINI_API_KEY=${config.localToken}`,
      '',
      '  OpenAI-compatible clients (Cline, Roo, Continue, Aider):',
      `    base URL  ${config.publicBaseUrl}/v1`,
      `    api key   ${config.localToken}`,
      '',
      '',
    ].join('\n'),
  );
});

// Streams outlive the default 2-minute header timeout, and a long generation
// must not be cut off by the server itself.
server.requestTimeout = 0;
server.headersTimeout = 65_000;

/** Trims the request log on a slow timer so the table cannot grow unbounded. */
const pruneTimer = setInterval(
  () => {
    try {
      const removed = logs.prune(settings.get().logRetentionDays);
      if (removed > 0) log.debug('pruned request logs', { removed });
    } catch (err) {
      log.error('log prune failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  60 * 60 * 1000,
);
pruneTimer.unref();

function shutdown(signal: string): void {
  log.info('shutting down', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // A stream that will not close must not block shutdown forever.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
