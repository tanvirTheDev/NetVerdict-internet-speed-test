import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI has already run `npm run build`, so exercise the production
    // server there — that is what actually ships. Locally, `dev` keeps the
    // loop fast and picks up edits without a rebuild.
    command: process.env['CI']
      ? 'npm run start --workspace=apps/web'
      : 'npm run dev --workspace=apps/web',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
