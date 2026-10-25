import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against workspace sources, not the built dist of @esphelm/schema.
    alias: {
      '@esphelm/schema': fileURLToPath(new URL('./packages/schema/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'firmware/test/**/*.test.ts'],
  },
});
