import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/notes/harness.html");
  await expect(
    page.getByRole("heading", { name: "Notes", exact: true, level: 1 }),
  ).toBeVisible();
});

test("has no automatically detectable accessibility violations", async ({
  page,
}) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("supports keyboard-only navigation into a container and back", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^tips/ }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "tips" })).toBeFocused();
  await expect(page.getByRole("button", { name: /^bash/ })).toBeVisible();

  await page.getByRole("button", { name: "Notes" }).click();
  await expect(
    page.getByRole("heading", { name: "Notes", level: 2 }),
  ).toBeFocused();
});

test("traps focus in the delete confirmation dialog and supports Escape to cancel", async ({
  page,
}) => {
  const hardinfoRow = page.locator("li.child-row", { hasText: "hardinfo" });
  await hardinfoRow.getByLabel("Actions for hardinfo").click();
  await hardinfoRow.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("hardinfo")).toBeVisible();
});

test("creates a new entry with the keyboard alone", async ({ page }) => {
  await page.getByLabel("Key").fill("keyboard-key");
  await page.getByLabel("Value").fill("keyboard value");
  await page.getByRole("button", { name: "Add entry" }).press("Enter");

  await expect(page.getByText("keyboard-key")).toBeVisible();
});

test("respects prefers-reduced-motion with no accessibility regressions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
