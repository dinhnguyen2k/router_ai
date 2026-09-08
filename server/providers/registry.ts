/**
 * Provider adapters.
 *
 * The router forwards request bodies byte-for-byte, so an adapter's only job is
 * to say where a request goes and how the credential is presented. Nothing here
 * rewrites payloads, tool-call ids, or response ids.
 */

import type {
  ProviderDescriptor,
  ProviderId,
  UpstreamProtocol,
} from '../../shared/types.js';

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    // Flash models only: the Pro tier moved behind billing, so suggesting a Pro
    // model would hand a free-tier key a model it cannot call. A paid key can
    // still add Pro by typing it into the model field.
    suggestedModels: [
      'gemini-3-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    suggestedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ],
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    suggestedModels: ['mistral-large-latest', 'mistral-small-latest'],
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'OpenAI-compatible',
    protocol: 'openai',
    defaultBaseUrl: '',
    suggestedModels: [],
  },
};

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function providerOf(id: ProviderId): ProviderDescriptor {
  return PROVIDERS[id];
}

export function protocolOf(id: ProviderId): UpstreamProtocol {
  return PROVIDERS[id].protocol;
}

/** Everything an adapter needs to issue one upstream call. */
export interface UpstreamTarget {
  url: string;
  headers: Record<string, string>;
}

export interface BuildTargetInput {
  protocol: UpstreamProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  stream: boolean;
  /**
   * Inbound headers worth forwarding. Only a small allowlist is passed through;
   * hop-by-hop and auth headers are dropped by the caller.
   */
  passthroughHeaders?: Record<string, string>;
  /**
   * Query string the client asked for, without the leading "?".
   *
   * Gemini clients select their streaming encoding with `alt`, so mirroring
   * the inbound query keeps the response in the shape the client expects
   * instead of forcing one encoding on every caller.
   */
  query?: string;
}

/**
 * Builds the upstream URL and headers for one attempt.
 *
 * Gemini puts the model and the streaming mode in the path, so the same logical
 * request produces a different URL per attempt; OpenAI-compatible upstreams
 * keep both in the body and need only the credential swapped.
 */
export function buildUpstreamTarget(input: BuildTargetInput): UpstreamTarget {
  const base = input.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: input.stream ? 'text/event-stream' : 'application/json',
    ...input.passthroughHeaders,
  };

  if (input.protocol === 'gemini') {
    const action = input.stream ? 'streamGenerateContent' : 'generateContent';
    const query = input.query === undefined || input.query === '' ? '' : `?${input.query}`;
    headers['x-goog-api-key'] = input.apiKey;
    return {
      url: `${base}/models/${encodeURIComponent(input.model)}:${action}${query}`,
      headers,
    };
  }

  headers.authorization = `Bearer ${input.apiKey}`;
  return { url: `${base}/chat/completions`, headers };
}

/** Builds the model-listing URL used to probe what a credential can serve. */
export function buildModelsUrl(
  protocol: UpstreamProtocol,
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  return protocol === 'gemini' ? `${base}/models` : `${base}/models`;
}

/**
 * Inbound headers that are safe to carry upstream. Everything else — auth,
 * host, hop-by-hop, and content-length — is either replaced or invalidated by
 * the proxy hop.
 */
const FORWARDABLE_HEADERS = new Set(['user-agent', 'x-request-id']);

export function pickForwardableHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (!FORWARDABLE_HEADERS.has(name)) continue;
    if (typeof value === 'string') out[name] = value;
    else if (Array.isArray(value) && value.length > 0) out[name] = value[0];
  }
  return out;
}
