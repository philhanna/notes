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

test("supports conventional keyboard-only tree navigation", async ({
  page,
}) => {
  const root = page.getByRole("treeitem", { name: /^Notes,/ });
  await root.focus();
  await page.keyboard.press("End");
  const tips = page.getByRole("treeitem", { name: /^tips,/ });
  await expect(tips).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(tips).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: /^bash,/ })).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(tips).toBeFocused();
});

test("traps focus in the delete confirmation dialog and supports Escape to cancel", async ({
  page,
}) => {
  const hardinfoRow = page.getByRole("treeitem", { name: /^hardinfo,/ });
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
  await page.getByRole("button", { name: "Add child to Notes" }).press("Enter");
  await page.getByLabel("Key").fill("keyboard-key");
  await page.getByLabel("Value").fill("keyboard value");
  await page.getByRole("button", { name: "Add entry" }).press("Enter");

  await expect(page.getByText("keyboard-key")).toBeVisible();
});

test("search reveals, selects, and focuses the exact matching node", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search notes").fill("recent history");
  await page.getByRole("button", { name: /fc/ }).click();

  const result = page.getByRole("treeitem", { name: /^fc,/ });
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("aria-selected", "true");
  await expect(result).toBeFocused();
});

test("respects prefers-reduced-motion with no accessibility regressions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
