/**
 * Token usage extraction.
 *
 * Usage is read opportunistically out of the bytes already flowing to the
 * client — the router never issues a second call or re-parses a whole response
 * to obtain it. A missing count is reported as null rather than zero, so the
 * dashboard can tell "no tokens" apart from "the upstream did not say".
 */

export interface UsageCounts {
  promptTokens: number | null;
  completionTokens: number | null;
}

export const EMPTY_USAGE: UsageCounts = { promptTokens: null, completionTokens: null };

/**
 * Collects usage from a streaming response without buffering it.
 *
 * Both supported protocols put usage in the last event they send, so only a
 * rolling tail is retained. The tail is sized to comfortably hold a final SSE
 * event while staying bounded on a multi-megabyte response.
 */
export class StreamUsageCollector {
  private tail = '';
  private readonly decoder = new TextDecoder();

  constructor(private readonly tailLimit = 32 * 1024) {}

  push(chunk: Uint8Array): void {
    this.tail += this.decoder.decode(chunk, { stream: true });
    if (this.tail.length > this.tailLimit) {
      this.tail = this.tail.slice(this.tail.length - this.tailLimit);
    }
  }

  result(): UsageCounts {
    return extractUsage(this.tail);
  }
}

interface RawUsage {
  prompt?: unknown;
  completion?: unknown;
}

function coerce(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Pulls usage out of a JSON object in either protocol's spelling.
 *
 * OpenAI-compatible uses usage.prompt_tokens / completion_tokens; Gemini uses
 * usageMetadata.promptTokenCount / candidatesTokenCount.
 */
export function usageFromObject(value: unknown): UsageCounts {
  if (typeof value !== 'object' || value === null) return EMPTY_USAGE;
  const root = value as Record<string, unknown>;

  const openai = root.usage;
  if (typeof openai === 'object' && openai !== null) {
    const usage = openai as Record<string, unknown>;
    const prompt = coerce(usage.prompt_tokens);
    const completion = coerce(usage.completion_tokens);
    if (prompt !== null || completion !== null) {
      return { promptTokens: prompt, completionTokens: completion };
    }
  }

  const gemini = root.usageMetadata;
  if (typeof gemini === 'object' && gemini !== null) {
    const usage = gemini as Record<string, unknown>;
    const prompt = coerce(usage.promptTokenCount);
    const completion = coerce(usage.candidatesTokenCount);
    if (prompt !== null || completion !== null) {
      return { promptTokens: prompt, completionTokens: completion };
    }
  }

  return EMPTY_USAGE;
}

/**
 * Scans SSE or JSON text for the last usage report it contains.
 *
 * Events are walked newest-first so a stream that reports incremental usage on
 * every chunk yields the final total rather than the first partial one.
 */
export function extractUsage(text: string): UsageCounts {
  if (text === '') return EMPTY_USAGE;

  // Whole-body JSON (non-streaming responses).
  const direct = tryParse(text.trim());
  if (direct !== null) {
    const usage = usageFromObject(direct);
    if (usage.promptTokens !== null || usage.completionTokens !== null) return usage;
  }

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    if (payload === '' || payload === '[DONE]') continue;
    const parsed = tryParse(payload);
    if (parsed === null) continue;
    const usage = usageFromObject(parsed);
    if (usage.promptTokens !== null || usage.completionTokens !== null) return usage;
  }
  return EMPTY_USAGE;
}

function tryParse(text: string): unknown {
  if (text === '' || (text[0] !== '{' && text[0] !== '[')) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
