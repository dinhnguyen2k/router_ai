import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Streaming tests drive a real socket; the default 5s is tight on Windows.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      // The router logs every routed request at info; at test volume that
      // buries the actual results.
      ROUTER_LOG_LEVEL: 'error',
    },
  },
});
