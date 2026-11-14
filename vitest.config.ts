import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The invariant sweeps generate thousands of riffs (now including 8-bar ones). They are
    // deterministic but can take several seconds under a parallel full-suite run.
    testTimeout: 30_000,
  },
});
