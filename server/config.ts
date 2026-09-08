/**
 * Process-level configuration. Everything here is fixed at boot; the tunables
 * that operators change at runtime live in the settings table instead.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

const dataDir = path.resolve(projectRoot, envStr('ROUTER_DATA_DIR', '.router-data'));
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Loads the at-rest encryption key for stored credentials.
 *
 * Preferring an env var lets an operator hold the key outside the project
 * directory. When none is set we generate one and persist it 0600 next to the
 * database, so a fresh clone works without setup but the key never lands in
 * git (.router-data is ignored).
 */
function loadEncryptionKey(): Buffer {
  const fromEnv = process.env.ROUTER_SECRET;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return crypto.createHash('sha256').update(fromEnv.trim()).digest();
  }
  const keyPath = path.join(dataDir, 'secret.key');
  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath, 'utf8').trim();
    if (stored.length === 64) return Buffer.from(stored, 'hex');
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

/**
 * The token inbound CLI clients must present.
 *
 * A router that forwards real provider credentials must not be an open relay
 * even on loopback, so a token is always required. If the operator does not
 * supply one we generate a stable one and print it at boot.
 */
function loadLocalToken(): string {
  const fromEnv = process.env.ROUTER_LOCAL_TOKEN;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();

  const tokenPath = path.join(dataDir, 'local-token');
  if (fs.existsSync(tokenPath)) {
    const stored = fs.readFileSync(tokenPath, 'utf8').trim();
    if (stored !== '') return stored;
  }
  const generated = `rtr-${crypto.randomBytes(24).toString('hex')}`;
  fs.writeFileSync(tokenPath, generated, { mode: 0o600 });
  return generated;
}

const port = envInt('ROUTER_PORT', 8787);
const host = envStr('ROUTER_HOST', '127.0.0.1');

export const config = {
  projectRoot,
  dataDir,
  databasePath: path.join(dataDir, 'router.db'),
  host,
  port,
  /** The stable endpoint a CLI is pointed at. */
  publicBaseUrl: envStr('ROUTER_PUBLIC_URL', `http://${host}:${port}`),
  localToken: loadLocalToken(),
  encryptionKey: loadEncryptionKey(),
  /** Where the dashboard's dev server runs, for CORS during `npm run dev`. */
  devOrigin: envStr('ROUTER_DEV_ORIGIN', 'http://localhost:3000'),
  logLevel: envStr('ROUTER_LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
