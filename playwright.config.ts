import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI (GitHub Actions' shared runners) was hitting extensive,
  // non-deterministic Playwright actionability-check timeouts ("element is
  // not visible" after 25+s of retrying an already-succeeded click) across
  // webkit/mobile-safari and even mobile-chrome — the exact same tests pass
  // 100% reliably run locally on the same engines, so this isn't a product
  // bug. No CI-runner metrics to confirm it directly, but the pattern
  // (worse on heavier engines, inconsistent between runs, unaffected by
  // adding retries within a single test) matches CPU contention:
  // `fullyParallel` with no worker cap spins up many concurrent browser
  // processes across 5 projects at once on a runner with few real cores;
  // under contention, layout/paint frames come far less often, so "stable
  // across two consecutive frames" (what a click waits for) can starve for
  // a long time — that reads as a hung click, not a slow one. Capped only
  // in CI; local runs keep Playwright's own default (faster iteration,
  // where this contention doesn't exist). Revert or raise this if CI still
  // flakes the same way afterward — that would mean the real cause is
  // something else.
  workers: process.env.CI ? 2 : undefined,
  // 'list' for readable console output during the run; 'html' so CI's
  // upload-artifact step (playwright-report/) has something to actually
  // upload — a real gap: without it, that step always silently found
  // nothing, even though per-test traces (trace: 'retain-on-failure' below)
  // were being generated the whole time, just never surfaced anywhere
  // retrievable after a CI run ended. open: 'never' — auto-opening a
  // browser to show the report would just hang in CI.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
});
