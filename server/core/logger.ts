/**
 * Structured logging.
 *
 * One JSON object per line so the output can be piped into anything, with a
 * human-readable fallback when stdout is a TTY. Credentials never reach here:
 * callers pass account ids and masked keys, never the key itself.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface LogFields {
  [key: string]: unknown;
}

// Seeded from the environment at import time so code paths that never call
// setLogLevel — tests, scripts — still honour ROUTER_LOG_LEVEL.
let threshold: number = LEVELS[(process.env.ROUTER_LOG_LEVEL ?? 'info') as LogLevel] ?? LEVELS.info;

export function setLogLevel(level: string): void {
  threshold = LEVELS[level as LogLevel] ?? LEVELS.info;
}

const useJson = !process.stdout.isTTY || process.env.ROUTER_LOG_JSON === 'true';

function emit(level: LogLevel, message: string, fields: LogFields): void {
  if (LEVELS[level] < threshold) return;

  if (useJson) {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...fields })}\n`,
    );
    return;
  }

  const time = new Date().toISOString().slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  const extras = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  process.stdout.write(`${time} ${tag} ${message}${extras === '' ? '' : ` ${extras}`}\n`);
}

export const log = {
  debug: (message: string, fields: LogFields = {}) => emit('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
};
