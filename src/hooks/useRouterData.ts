/**
 * Data hooks for the dashboard.
 *
 * Everything polls rather than subscribing: the router is a local process and
 * the dashboard is one tab, so a short interval is simpler than a socket and
 * cannot leave the UI showing stale state after a reconnect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type ConnectionInfo } from '../api/client';
import { toAccountView, type AIAccount } from '../types';
import type {
  MetricsSummaryDto,
  PoolStatusDto,
  ProviderDescriptor,
  ProviderUsageDto,
  RequestLogDto,
  RouterSettingsDto,
  TimelinePointDto,
} from '../../shared/types';

/** How often live views refresh. */
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * Polls `loader` on an interval, keeping the last good value while a refresh is
 * in flight so the UI never flashes empty between ticks.
 */
function usePolled<T>(
  loader: () => Promise<T>,
  initial: T,
  intervalMs: number,
  enabled = true,
): AsyncState<T> & { refresh: () => void } {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    try {
      const next = await loaderRef.current();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void run();
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [run, intervalMs, enabled]);

  return { data, loading, error, refresh: () => void run() };
}

/**
 * The account list, already mapped to view models.
 *
 * Mapping happens on every tick rather than being memoised, because cooldown
 * countdowns are derived from the current clock and a memo keyed on the DTO
 * would freeze them.
 */
export function useAccounts() {
  const state = usePolled<AIAccount[]>(
    async () => {
      const dtos = await api.accounts();
      const now = Date.now();
      return dtos.map((dto) => toAccountView(dto, now));
    },
    [],
    FAST_POLL_MS,
  );

  // A local tick keeps cooldown countdowns moving between server polls, so a
  // 2-second poll does not make the remaining seconds jump in steps of two.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return state;
}

export function useStatus() {
  return usePolled<PoolStatusDto | null>(() => api.status(), null, FAST_POLL_MS);
}

export function useMetrics(windowMs: number) {
  return usePolled<MetricsSummaryDto | null>(
    () => api.metrics(windowMs),
    null,
    SLOW_POLL_MS,
  );
}

export function useTimeline(windowMs: number, buckets: number) {
  return usePolled<TimelinePointDto[]>(
    () => api.timeline(windowMs, buckets),
    [],
    SLOW_POLL_MS,
  );
}

export function useProviderUsage(windowMs: number) {
  return usePolled<ProviderUsageDto[]>(() => api.providerUsage(windowMs), [], SLOW_POLL_MS);
}

export function useLogs(filter: { outcome?: string; limit?: number }, enabled: boolean) {
  return usePolled<RequestLogDto[]>(
    () => api.logs({ outcome: filter.outcome, limit: filter.limit ?? 100 }),
    [],
    FAST_POLL_MS,
    enabled,
  );
}

/** Providers and the connection snippet change only on restart. */
export function useStaticConfig() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, info] = await Promise.all([api.providers(), api.connection()]);
        if (cancelled) return;
        setProviders(list);
        setConnection(info);
      } catch {
        // The status panel already surfaces an unreachable router; failing
        // quietly here avoids a second copy of the same error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, connection };
}

export function useSettings() {
  const [settings, setSettings] = useState<RouterSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .settings()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (patch: Partial<RouterSettingsDto>) => {
    setSaving(true);
    try {
      // The server returns the normalised result, so the UI shows the value
      // that was actually stored rather than what was typed.
      setSettings(await api.updateSettings(patch));
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, saving, save };
}
