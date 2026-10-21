import { defineConfig } from '@playwright/test';

// Runs against the built app (`pnpm test:e2e` builds first). On Linux CI run it
// under `xvfb-run -a`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
