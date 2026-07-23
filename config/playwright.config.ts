import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Two independent servers, matching two different things this suite tests:
 * - "harness" (vite dev, fast) drives the real tree/search UI wired to
 *   an in-memory repository (src/harness.tsx) — keyboard operation, focus
 *   management, and an axe accessibility scan, without live GitHub.
 * - "pwa" (vite preview over the actual `dist/` build) exercises the
 *   service worker, manifest, and offline behavior, which only work against
 *   a real production build (registerServiceWorker bails out otherwise).
 */
export default defineConfig({
  testDir: "../e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  webServer: [
    {
      command: "npm run dev -- --port 5183 --strictPort",
      cwd: projectRoot,
      url: "http://localhost:5183/notes/harness.html",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run preview -- --port 4183 --strictPort",
      cwd: projectRoot,
      url: "http://localhost:4183/notes/",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: "harness",
      testMatch: /harness\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5183" },
    },
    {
      name: "pwa",
      testMatch: /pwa\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4183" },
    },
  ],
});
