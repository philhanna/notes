import { afterEach, describe, expect, it } from "vitest";
import {
  clearShortcuts,
  loadPinned,
  loadRecent,
  orderedMostRecentFirst,
  recordVisit,
  savePinned,
  saveRecent,
} from "./shortcutsStorage.ts";

afterEach(() => {
  localStorage.clear();
});

describe("shortcutsStorage", () => {
  it("round-trips a saved pinned set, stored separately from recent", () => {
    expect(loadPinned()).toEqual(new Set());
    savePinned(new Set(["/alpha", "/beta"]));
    saveRecent(new Set(["/gamma"]));
    expect(loadPinned()).toEqual(new Set(["/alpha", "/beta"]));
    expect(loadRecent()).toEqual(new Set(["/gamma"]));
  });

  it("clears both lists on sign-out", () => {
    savePinned(new Set(["/alpha"]));
    saveRecent(new Set(["/beta"]));
    clearShortcuts();
    expect(loadPinned()).toEqual(new Set());
    expect(loadRecent()).toEqual(new Set());
  });

  it("moves a re-visited pointer to the most-recent end instead of duplicating it", () => {
    let recent = new Set<string>();
    recent = recordVisit(recent, "/alpha");
    recent = recordVisit(recent, "/beta");
    recent = recordVisit(recent, "/alpha");
    expect(orderedMostRecentFirst(recent)).toEqual(["/alpha", "/beta"]);
  });

  it("drops the oldest entry once the cap is exceeded", () => {
    let recent = new Set<string>();
    for (let index = 0; index < 21; index += 1) {
      recent = recordVisit(recent, `/item-${index}`);
    }
    expect(recent.size).toBe(20);
    expect(recent.has("/item-0")).toBe(false);
    expect(orderedMostRecentFirst(recent)[0]).toBe("/item-20");
  });
});
