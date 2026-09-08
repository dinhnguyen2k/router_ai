/**
 * Management API consumed by the dashboard.
 *
 * Kept on a separate mount from the gateway so a CLI token can never reach
 * account administration, and so the two surfaces can be reasoned about (and
 * later secured) independently.
 */

import express, { type Request, type Response, type Router } from 'express';
import { AccountPool } from '../core/pool.js';
import { RouterCore } from '../core/router.js';
import type { LogStore } from '../db/logs.js';
import type { SettingsStore } from '../db/settings.js';
import { PROVIDERS, isProviderId } from '../providers/registry.js';
import { log } from '../core/logger.js';
import type {
  CreateAccountInput,
  PoolStatusDto,
  ProviderId,
  UpdateAccountInput,
} from '../../shared/types.js';

export interface ManagementDeps {
  pool: AccountPool;
  core: RouterCore;
  logs: LogStore;
  settings: SettingsStore;
  endpointBaseUrl: string;
  localToken: string;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'bad_request', message } });
}

function notFound(res: Response, message: string): void {
  res.status(404).json({ error: { code: 'not_found', message } });
}

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function asPositiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function windowFromQuery(req: Request, fallback: number): number {
  const raw = req.query.window;
  const parsed = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  // Capped at 30 days so a mistyped window cannot ask the log table for
  // everything it has ever stored.
  return Math.min(parsed, 30 * 24 * 60 * 60 * 1000);
}

export function createManagementApi(deps: ManagementDeps): Router {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // --- Status & providers --------------------------------------------------

  router.get('/status', (_req, res) => {
    const now = Date.now();
    const accounts = deps.pool.all();
    let active = 0;
    let cooldown = 0;
    let tempError = 0;
    let disabled = 0;
    let serving: { id: string; inFlight: number } | null = null;

    for (const account of accounts) {
      switch (deps.pool.healthOf(account, now)) {
        case 'ACTIVE':
          active += 1;
          break;
        case 'COOLDOWN':
          cooldown += 1;
          break;
        case 'TEMP_ERROR':
          tempError += 1;
          break;
        case 'DISABLED':
          disabled += 1;
          break;
      }
      if (account.inFlight > 0 && (serving === null || account.inFlight > serving.inFlight)) {
        serving = { id: account.id, inFlight: account.inFlight };
      }
    }

    // With nothing in flight the dashboard still wants to name the credential
    // that would serve the next request, so it falls back to the most recently
    // used healthy one rather than showing "none".
    let servingAccountId = serving?.id ?? null;
    if (servingAccountId === null) {
      const healthy = accounts
        .filter((account) => deps.pool.healthOf(account, now) === 'ACTIVE')
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
      servingAccountId = healthy[0]?.id ?? null;
    }

    const status: PoolStatusDto = {
      totalAccounts: accounts.length,
      activeAccounts: active,
      cooldownAccounts: cooldown,
      tempErrorAccounts: tempError,
      disabledAccounts: disabled,
      inFlight: deps.pool.totalInFlight(),
      servingAccountId,
      strategy: deps.core.strategy.getStrategy(),
      endpoint: {
        baseUrl: deps.endpointBaseUrl,
        openaiPath: '/v1',
        geminiPath: '/v1beta',
        authRequired: true,
      },
      uptimeMs: deps.core.uptimeMs,
    };
    res.json(status);
  });

  router.get('/providers', (_req, res) => {
    res.json(Object.values(PROVIDERS));
  });

  /**
   * Reveals the local token so the dashboard can show a copyable CLI snippet.
   *
   * The management API is bound to loopback alongside the dashboard it serves;
   * anyone who can reach it can already read the accounts.
   */
  router.get('/connection', (_req, res) => {
    res.json({
      baseUrl: deps.endpointBaseUrl,
      token: deps.localToken,
      openaiBaseUrl: `${deps.endpointBaseUrl}/v1`,
      geminiBaseUrl: `${deps.endpointBaseUrl}/v1beta`,
    });
  });

  // --- Accounts ------------------------------------------------------------

  router.get('/accounts', (_req, res) => {
    res.json(deps.pool.snapshot());
  });

  router.get('/accounts/:id', (req, res) => {
    const account = deps.pool.get(req.params.id);
    if (account === undefined) {
      notFound(res, `no account with id ${req.params.id}`);
      return;
    }
    res.json(deps.pool.toDto(account));
  });

  router.post('/accounts', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const provider = typeof body.provider === 'string' ? body.provider : '';
    if (!isProviderId(provider)) {
      badRequest(res, `unknown provider "${provider}"`);
      return;
    }
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey === '') {
      badRequest(res, 'apiKey is required');
      return;
    }

    const input: CreateAccountInput = {
      name: typeof body.name === 'string' ? body.name : '',
      provider: provider as ProviderId,
      apiKey,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      models: asStringArray(body.models),
      priority: asPositiveInt(body.priority),
      weight: asPositiveInt(body.weight),
      maxConcurrent: asPositiveInt(body.maxConcurrent),
      dailyTokenBudget: asPositiveInt(body.dailyTokenBudget),
      tags: asStringArray(body.tags),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    };

    try {
      const account = deps.pool.create(input);
      log.info('account added', { account: account.name, provider: account.provider });
      res.status(201).json(deps.pool.toDto(account));
    } catch (err) {
      badRequest(res, err instanceof Error ? err.message : 'could not create account');
    }
  });

  router.patch('/accounts/:id', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const input: UpdateAccountInput = {
      name: typeof body.name === 'string' ? body.name : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      models: asStringArray(body.models),
      priority: asPositiveInt(body.priority),
      weight: asPositiveInt(body.weight),
      maxConcurrent: asPositiveInt(body.maxConcurrent),
      dailyTokenBudget: asPositiveInt(body.dailyTokenBudget),
      tags: asStringArray(body.tags),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    };

    const account = deps.pool.update(req.params.id, input);
    if (account === null) {
      notFound(res, `no account with id ${req.params.id}`);
      return;
    }
    res.json(deps.pool.toDto(account));
  });

  router.delete('/accounts/:id', (req, res) => {
    if (!deps.pool.remove(req.params.id)) {
      notFound(res, `no account with id ${req.params.id}`);
      return;
    }
    res.status(204).end();
  });

  // --- Cooldown controls ---------------------------------------------------

  router.post('/accounts/:id/cooldown', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const durationMs = asPositiveInt(body.durationMs) ?? 120_000;
    const reason = typeof body.reason === 'string' && body.reason.trim() !== ''
      ? body.reason.trim()
      : 'held out of rotation manually';

    if (!deps.pool.forceCooldown(req.params.id, durationMs, reason)) {
      notFound(res, `no account with id ${req.params.id}`);
      return;
    }
    res.json(deps.pool.toDto(deps.pool.get(req.params.id)!));
  });

  router.post('/accounts/:id/clear-cooldown', (req, res) => {
    if (!deps.pool.clearCooldown(req.params.id)) {
      notFound(res, `no account with id ${req.params.id}`);
      return;
    }
    res.json(deps.pool.toDto(deps.pool.get(req.params.id)!));
  });

  router.post('/cooldowns/clear', (_req, res) => {
    const cleared = deps.pool.clearAllCooldowns();
    res.json({ cleared });
  });

  // --- Settings ------------------------------------------------------------

  router.get('/settings', (_req, res) => {
    res.json(deps.settings.get());
  });

  router.put('/settings', (req, res) => {
    const next = deps.settings.update(req.body as Record<string, never>);
    // Live objects cache a copy of the settings they care about.
    deps.core.applySettings();
    log.info('settings updated', { strategy: next.strategy });
    res.json(next);
  });

  // --- Logs & metrics ------------------------------------------------------

  router.get('/logs', (req, res) => {
    const limit = asPositiveInt(req.query.limit) ?? 100;
    const before = asPositiveInt(req.query.before);
    const outcome = typeof req.query.outcome === 'string' ? req.query.outcome : undefined;
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
    res.json(deps.logs.list({ limit, before, outcome, accountId }));
  });

  router.get('/metrics', (req, res) => {
    res.json(deps.logs.summary(windowFromQuery(req, 24 * 60 * 60 * 1000)));
  });

  router.get('/metrics/timeline', (req, res) => {
    const window = windowFromQuery(req, 24 * 60 * 60 * 1000);
    const buckets = Math.min(Math.max(asPositiveInt(req.query.buckets) ?? 24, 4), 168);
    res.json(deps.logs.timeline(window, buckets));
  });

  router.get('/metrics/providers', (req, res) => {
    res.json(deps.logs.providerUsage(windowFromQuery(req, 24 * 60 * 60 * 1000)));
  });

  return router;
}
