/**
 * Global concurrency gate.
 *
 * Per-credential limits live on the account itself and are enforced by the
 * selector, which simply skips a saturated credential. This gate is the pool-
 * wide backstop: without it, a client that opens 200 streams at once would put
 * 200 requests into the retry machinery simultaneously, and the first upstream
 * hiccup would turn that into a retry storm against every credential at once.
 */

export class Semaphore {
  private available: number;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    onAbort: (() => void) | null;
    signal: AbortSignal | undefined;
  }> = [];

  constructor(private limit: number) {
    this.available = limit;
  }

  get inUse(): number {
    return this.limit - this.available;
  }

  get queued(): number {
    return this.waiters.length;
  }

  /**
   * Resizes the gate at runtime.
   *
   * Shrinking below the current in-use count is allowed; it does not cancel
   * anything in flight, it just stops new work until enough finishes.
   */
  resize(limit: number): void {
    const next = Math.max(1, limit);
    const delta = next - this.limit;
    this.limit = next;
    this.available += delta;
    this.drain();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
    }
    if (this.available > 0) {
      this.available -= 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, onAbort: null as (() => void) | null, signal };
      if (signal !== undefined) {
        // A client that gives up while queued must free its slot in the queue
        // immediately, otherwise a burst of abandoned requests keeps healthy
        // ones waiting behind work nobody is going to consume.
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  release(): void {
    this.available += 1;
    this.drain();
  }

  private drain(): void {
    while (this.available > 0 && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) break;
      if (waiter.onAbort !== null && waiter.signal !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      this.available -= 1;
      waiter.resolve();
    }
  }
}

/**
 * Sleeps, but wakes early and throws if the signal aborts.
 *
 * Every backoff wait in the router goes through this: a plain setTimeout would
 * keep a cancelled request occupying a concurrency slot for the length of a
 * cooldown.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onAbort !== null && signal !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    let onAbort: (() => void) | null = null;
    if (signal !== undefined) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        return;
      }
      onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
