/**
 * Gateway surface tests.
 *
 * These drive the router the way a real client does — over a socket, with the
 * exact path shape and auth header the client library produces — so a change
 * that breaks Antigravity CLI or an OpenAI-compatible tool fails here rather
 * than in the user's terminal.
 */

import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGateway } from '../server/gateway/index.js';
import { createStack, startUpstream, upstream, type FakeUpstream, type TestStack } from './helpers.js';

const LOCAL_TOKEN = 'rtr-test-token-0123456789';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

interface Harness {
  baseUrl: string;
  stack: TestStack;
}

async function startGateway(stack: TestStack): Promise<Harness> {
  const app = express();
  app.use(createGateway({ core: stack.core, pool: stack.pool, localToken: LOCAL_TOKEN }));
  // Stands in for the static dashboard the server mounts after the gateway.
  app.get('/', (_req, res) => {
    res.status(200).send('dashboard');
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { baseUrl: `http://127.0.0.1:${port}`, stack };
}

function track<T extends TestStack | FakeUpstream>(value: T): T {
  cleanup.push(() => value.close());
  return value;
}

async function harnessWith(handlers: Parameters<typeof startUpstream>[0]): Promise<{
  gateway: Harness;
  up: FakeUpstream;
}> {
  const stack = track(createStack());
  const up = track(await startUpstream(handlers));
  const gateway = await startGateway(stack);
  return { gateway, up };
}

function addGeminiAccount(stack: TestStack, baseUrl: string, models: string[]) {
  return stack.pool.create({
    name: 'gemini-key',
    provider: 'gemini',
    apiKey: 'AIzaSy-test-key-0123456789',
    baseUrl,
    models,
  });
}

// ---------------------------------------------------------------------------

describe('local authentication', () => {
  it('rejects a request with no token', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1/models`);
    expect(response.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1/models`, {
      headers: { authorization: 'Bearer wrong-token-0123456789' },
    });
    expect(response.status).toBe(401);
  });

  it('accepts a Bearer token', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${LOCAL_TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it('accepts x-goog-api-key, which is how a Google SDK sends it', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1beta/models`, {
      headers: { 'x-goog-api-key': LOCAL_TOKEN },
    });
    expect(response.status).toBe(200);
  });

  it('accepts ?key=, which is how older Google clients send it', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1beta/models?key=${LOCAL_TOKEN}`);
    expect(response.status).toBe(200);
  });
});

describe('Gemini surface', () => {
  it('routes the path shape a Google SDK builds from GOOGLE_GEMINI_BASE_URL', async () => {
    const { gateway, up } = await harnessWith([upstream.stream('from gemini')]);
    addGeminiAccount(gateway.stack, up.baseUrl, ['gemini-2.5-pro']);

    const response = await fetch(
      `${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('from gemini');
  });

  it('tolerates a doubled version prefix from a misconfigured base URL', async () => {
    const { gateway, up } = await harnessWith([upstream.stream('still routed')]);
    addGeminiAccount(gateway.stack, up.baseUrl, ['gemini-2.5-pro']);

    // What a client produces when the base URL was set to ".../v1beta" and the
    // SDK appends its own version segment.
    const response = await fetch(
      `${gateway.baseUrl}/v1beta/v1beta/models/gemini-2.5-pro:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [] }),
      },
    );

    expect(response.status).toBe(200);
  });

  it('mirrors the alt parameter upstream but never forwards the local token', async () => {
    const { gateway, up } = await harnessWith([upstream.stream()]);
    addGeminiAccount(gateway.stack, up.baseUrl, ['gemini-2.5-pro']);

    await fetch(
      `${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse&key=${LOCAL_TOKEN}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [] }),
      },
    );

    expect(up.requests[0].url).toContain('alt=sse');
    expect(up.requests[0].url).not.toContain(LOCAL_TOKEN);
  });

  it('presents the pooled credential upstream, not the local token', async () => {
    const { gateway, up } = await harnessWith([upstream.stream()]);
    addGeminiAccount(gateway.stack, up.baseUrl, ['gemini-2.5-pro']);

    await fetch(`${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    });

    expect(up.requests[0].headers['x-goog-api-key']).toBe('AIzaSy-test-key-0123456789');
  });

  it('selects the streaming action from the path', async () => {
    const { gateway, up } = await harnessWith([upstream.json({ candidates: [] })]);
    addGeminiAccount(gateway.stack, up.baseUrl, ['gemini-2.5-pro']);

    await fetch(`${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    });

    expect(up.requests[0].url).toContain(':generateContent');
    expect(up.requests[0].url).not.toContain(':streamGenerateContent');
  });

  it('lists the models the pool can serve', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    addGeminiAccount(stack, 'http://127.0.0.1:1/v1beta', ['gemini-2.5-pro', 'gemini-2.5-flash']);

    const response = await fetch(`${gateway.baseUrl}/v1beta/models`, {
      headers: { 'x-goog-api-key': LOCAL_TOKEN },
    });
    const payload = (await response.json()) as { models: Array<{ name: string }> };
    expect(payload.models.map((m) => m.name)).toEqual([
      'models/gemini-2.5-flash',
      'models/gemini-2.5-pro',
    ]);
  });
});

describe('OpenAI surface', () => {
  it('routes a chat completion and streams it back', async () => {
    const { gateway, up } = await harnessWith([upstream.stream('from openai')]);
    gateway.stack.pool.create({
      name: 'openai-key',
      provider: 'openai_compatible',
      apiKey: 'sk-test-0123456789',
      baseUrl: up.baseUrl,
      models: ['test-model'],
    });

    const response = await fetch(`${gateway.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', stream: true, messages: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('from openai');
    expect(up.requests[0].headers.authorization).toBe('Bearer sk-test-0123456789');
  });

  it('rejects a body with no model rather than guessing one', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);

    const response = await fetch(`${gateway.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'missing_model',
    );
  });

  it('forwards the body unmodified', async () => {
    const { gateway, up } = await harnessWith([upstream.stream()]);
    gateway.stack.pool.create({
      name: 'openai-key',
      provider: 'openai_compatible',
      apiKey: 'sk-test-0123456789',
      baseUrl: up.baseUrl,
      models: ['test-model'],
    });

    const raw = '{"model":"test-model","stream":true,"tool_choice":"auto","temperature":0.70}';
    await fetch(`${gateway.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' },
      body: raw,
    });

    expect(up.requests[0].body).toBe(raw);
  });
});

describe('failover through the gateway', () => {
  it('serves the request from a second credential after the first is rate limited', async () => {
    const stack = track(createStack());
    const failing = track(await startUpstream([upstream.error(429)]));
    const healthy = track(await startUpstream([upstream.stream('served by backup')]));
    const gateway = await startGateway(stack);

    addGeminiAccount(stack, failing.baseUrl, ['gemini-2.5-pro']);
    addGeminiAccount(stack, healthy.baseUrl, ['gemini-2.5-pro']);

    const response = await fetch(
      `${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [] }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('served by backup');
  });

  it('reports an exhausted pool as 429 rather than hanging', async () => {
    const stack = track(createStack({ requestRetryRounds: 0 }));
    const failing = track(await startUpstream([upstream.error(429)]));
    const gateway = await startGateway(stack);
    addGeminiAccount(stack, failing.baseUrl, ['gemini-2.5-pro']);

    const url = `${gateway.baseUrl}/v1beta/models/gemini-2.5-pro:generateContent`;
    const init = {
      method: 'POST',
      headers: { 'x-goog-api-key': LOCAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    };

    await fetch(url, init);
    const second = await fetch(url, init);
    expect(second.status).toBe(429);
  });
});

describe('path ownership', () => {
  it('lets a non-gateway path through to whatever is mounted after it', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);

    // The dashboard must load in a browser that has no router token.
    const response = await fetch(`${gateway.baseUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('dashboard');
  });

  it('still guards its own paths', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    expect((await fetch(`${gateway.baseUrl}/v1/models`)).status).toBe(401);
  });

  it('answers 404 for an unknown path inside its own namespace', async () => {
    const stack = track(createStack());
    const gateway = await startGateway(stack);
    const response = await fetch(`${gateway.baseUrl}/v1/nonsense`, {
      headers: { authorization: `Bearer ${LOCAL_TOKEN}` },
    });
    expect(response.status).toBe(404);
  });
});
