import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Both extensions, because a suite that renders a component with JSX is a
    // `.tsx` file and would otherwise be written, committed and silently never
    // run. Still rooted at `src/`, so nothing generated or built is in scope.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
  // Next requires `jsx: "preserve"` in tsconfig because its own compiler handles
  // JSX, so the test transformer has to be told otherwise or importing a
  // presentational component fails to parse. Vite 8 transforms with oxc.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See `test-server-only-stub.ts`: the real guard stays in the source and
      // still applies to the production build.
      'server-only': fileURLToPath(new URL('./src/test-server-only-stub.ts', import.meta.url)),
    },
  },
});
