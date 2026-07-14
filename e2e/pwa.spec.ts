import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("the pre-auth sign-in screen has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/notes/");
  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

/**
 * A service worker only starts intercepting requests once it controls the
 * page, and it can't control the very page load that registered it (that
 * load's own JS/CSS requests are already in flight before the worker
 * exists). So the shell's assets only get cached starting from a *second*
 * online visit — this reload is that second visit, matching how a real
 * repeat visitor's browser would actually end up with the assets cached.
 */
async function primeServiceWorkerCache(page: Page) {
  await page.goto("/notes/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("registers a service worker that caches the shell for offline use", async ({
  page,
  context,
}) => {
  await primeServiceWorkerCache(page);

  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Notes", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(/You.re offline/, { exact: false }),
  ).toBeVisible();

  await context.setOffline(false);
});

test("shows no note content while signed out, even offline after a fresh launch", async ({
  page,
  context,
}) => {
  await primeServiceWorkerCache(page);

  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  expect(await page.content()).not.toContain("hardinfo");

  await context.setOffline(false);
});
