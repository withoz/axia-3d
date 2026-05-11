/**
 * ADR-075 E4-1 — Playwright E2E configuration.
 *
 * Per ADR-075 §B lock-ins (Path Z atomic Path Y answer):
 * - E4-B Playwright (industry standard, headless, WASM support)
 * - E4-C Vite preview (production-similar build)
 * - E4-G Chromium only (atomic starting point; Firefox/WebKit deferred
 *   to a future sub-step)
 * - E4-J `web/e2e/` directory
 *
 * Lock-in #4: Random port allocation via `port: 0` + `webServer.url`
 * is unstable across runs — use a fixed port that's unlikely to clash
 * with `npm run dev` (5173) and `npm run preview` default (4173).
 * Pick 4179 — close to preview default, easy to remember.
 */
import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = 4179;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,  // E4-1 single-worker for atomic smoke; E4-6 may relax
  forbidOnly: !!process.env.CI,  // refuse `test.only` in CI
  retries: process.env.CI ? 2 : 0,
  workers: 1,  // E4-G atomic — one browser, one worker
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,  // 30s per test (WASM init can take a moment)
  // ADR-077 V-1 — Visual regression infrastructure.
  // V-D: 1% pixel ratio threshold absorbs anti-aliasing / sub-pixel
  //      rendering differences across runs.
  // V-E: animations disabled for deterministic capture.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      // 2026-05-11 hardening: Linux CI WASM boot + Three.js initial
      // frame stabilization can exceed 5s default. Bump to 15s so
      // first-run baseline generation succeeds on slower CI hosts.
      timeout: 15_000,
    },
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // V-1 — fixed viewport ensures baseline consistency across runs.
    // 1280×720 = standard 16:9, large enough for axes + viewport UI
    // but stable across DPR variations.
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Vite preview server — boots the production-like build before tests.
  webServer: {
    command: `npm run preview -- --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
