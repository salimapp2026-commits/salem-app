import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Release gates (e.g. the crisis help numbers) run with `npm run test:release`.
    exclude: ['tests/release/**', 'node_modules/**'],
    environment: 'node',
    // Each SQL suite boots its own Postgres (PGlite); more than 4 at once starves the
    // machine (with the emulator running) and slow suites time out.
    maxWorkers: 4,
  },
});
