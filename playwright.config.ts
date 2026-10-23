import { defineConfig } from '@playwright/test';
// FRONTEND_PORT lets a test run use its own port, isolated from a normal app on 5173.
const port = Number(process.env.FRONTEND_PORT || 5173);
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { baseURL: process.env.FRONTEND_URL || url, trace: 'retain-on-failure' },
  reporter: 'list',
  webServer: {command: `npm run dev -- --port ${port} --strictPort`, url, reuseExistingServer: !process.env.CI, timeout: 30000},
});
