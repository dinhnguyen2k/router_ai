/**
 * Streaming state machine.
 *
 * The single rule this file exists to enforce: once one byte of upstream
 * output has been written to the client, the request is COMMITTED and can
 * never be retried on another credential. Splicing a second upstream's output
 * onto a partially delivered stream would produce a response that no upstream
 * ever generated — duplicated or contradictory tool calls, two response ids,
 * interleaved content — and the client has no way to detect it.
 *
 * Before that point the router is free to fail over, because nothing has
 * reached the client and the request can be replayed verbatim.
 *
 * Mirrors CLIProxyAPI's readStreamBootstrap: buffer upstream chunks until the
 * first non-empty payload arrives, and treat any failure up to that moment as
 * a bootstrap failure rather than a stream failure.
 */

export type StreamPhase =
  | 'connecting'
  /** Upstream accepted; waiting for the first payload. Failover still legal. */
  | 'bootstrap'
  /** Bytes have reached the client. Failover is now forbidden. */
  | 'committed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export class StreamState {
  private phase: StreamPhase = 'connecting';
  private bytesForwarded = 0;
  private firstByteAt: number | null = null;

  constructor(private readonly startedAt: number = Date.now()) {}

  get current(): StreamPhase {
    return this.phase;
  }

  /**
   * Whether the request may still be moved to another credential.
   *
   * This is the only question the retry loop is allowed to ask before choosing
   * to fail over.
   */
  get canFailover(): boolean {
    return this.phase === 'connecting' || this.phase === 'bootstrap';
  }

  get committed(): boolean {
    return (
      this.phase === 'committed' ||
      this.phase === 'completed' ||
      (this.phase !== 'connecting' && this.bytesForwarded > 0)
    );
  }

  get ttfbMs(): number | null {
    return this.firstByteAt === null ? null : this.firstByteAt - this.startedAt;
  }

  get forwarded(): number {
    return this.bytesForwarded;
  }

  /** Upstream returned a 2xx; the body is now being read. */
  markUpstreamAccepted(): void {
    if (this.phase === 'connecting') this.phase = 'bootstrap';
  }

  /**
   * Records that bytes were handed to the client. Irreversible: from here the
   * request is pinned to the credential that produced them.
   */
  markCommitted(byteCount: number, at = Date.now()): void {
    if (byteCount <= 0) return;
    if (this.firstByteAt === null) this.firstByteAt = at;
    this.bytesForwarded += byteCount;
    if (this.phase === 'connecting' || this.phase === 'bootstrap') {
      this.phase = 'committed';
    }
  }

  markCompleted(): void {
    if (this.phase === 'committed' || this.phase === 'bootstrap') {
      this.phase = 'completed';
    }
  }

  markFailed(): void {
    if (this.phase !== 'cancelled') this.phase = 'failed';
  }

  markCancelled(): void {
    this.phase = 'cancelled';
  }
}

/** Chunks buffered during bootstrap, replayed once the stream commits. */
export interface StreamBootstrap {
  /** Payload chunks read before the first non-empty one, plus that chunk. */
  buffered: Uint8Array[];
  /** True when the upstream ended without ever producing a payload. */
  exhausted: boolean;
}

/**
 * Reads from an upstream byte stream until the first non-empty chunk.
 *
 * Nothing is written downstream here. The caller gets either a bootstrap it can
 * replay (with the reader positioned just after it) or a throw, and a throw at
 * this point is always safe to fail over because the client has seen nothing.
 *
 * Empty chunks are consumed rather than returned: some upstreams emit SSE
 * keep-alive padding before the first real event, and treating that padding as
 * a commit would forfeit failover for no delivered content.
 */
export async function readStreamBootstrap(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<StreamBootstrap> {
  const buffered: Uint8Array[] = [];

  for (;;) {
    if (signal?.aborted === true) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error('aborted while reading stream bootstrap');
    }

    const { value, done } = await reader.read();
    if (done) {
      return { buffered, exhausted: true };
    }
    if (value === undefined || value.byteLength === 0) {
      continue;
    }
    buffered.push(value);
    return { buffered, exhausted: false };
  }
}

/**
 * Formats a terminal error as an SSE event.
 *
 * Used only after the stream has committed: at that point the error cannot be
 * returned as an HTTP status because the 200 and its headers are already sent,
 * so the client is told inline and the stream is closed. Clients that ignore
 * the event still see the stream end without a completion marker.
 */
export function sseErrorEvent(payload: {
  message: string;
  type: string;
  code?: string | null;
}): string {
  const body = JSON.stringify({
    error: {
      message: payload.message,
      type: payload.type,
      code: payload.code ?? null,
    },
  });
  return `event: error\ndata: ${body}\n\n`;
}

/** Terminator emitted by OpenAI-compatible SSE streams. */
export const SSE_DONE = 'data: [DONE]\n\n';
