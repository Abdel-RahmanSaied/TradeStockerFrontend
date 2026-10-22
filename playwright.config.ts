import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { baseURL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  reporter: 'list',
  webServer: {command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30000},
});
