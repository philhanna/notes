import { describe, expect, it } from "vitest";
import { buildSearchIndex, search } from "./search.ts";

describe("buildSearchIndex/search", () => {
  const document = {
    tips: {
      bash: { fc: "repeat the last command" },
    },
    club_ids: [42, "member-7"],
    "with rating": true,
    empty: {},
  };

  it("matches a key case-insensitively, plus anything nested under it (its breadcrumb also contains the query)", () => {
    const results = search(buildSearchIndex(document), "BASH");
    expect(results.map((r) => r.path)).toEqual([
      ["tips", "bash"],
      ["tips", "bash", "fc"],
    ]);
    expect(results[0]!.matchedIn).toBe("key");
    expect(results[1]!.matchedIn).toBe("breadcrumb");
  });

  it("matches a scalar string value case-insensitively", () => {
    const results = search(buildSearchIndex(document), "last command");
    expect(results.map((r) => r.path)).toEqual([["tips", "bash", "fc"]]);
    expect(results[0]!.matchedIn).toBe("value");
    expect(results[0]!.containerPath).toEqual(["tips", "bash"]);
  });

  it("matches a numeric value's textual representation", () => {
    const results = search(buildSearchIndex(document), "42");
    expect(results.map((r) => r.path)).toEqual([["club_ids", 0]]);
    expect(results[0]!.label).toBe("[0]");
  });

  it("matches a boolean value's textual representation", () => {
    const results = search(buildSearchIndex(document), "true");
    expect(results.map((r) => r.path)).toEqual([["with rating"]]);
  });

  it("matches a breadcrumb path even when neither key nor value matches", () => {
    const results = search(buildSearchIndex(document), "tips ›");
    expect(results.some((r) => r.path.join() === ["tips", "bash"].join())).toBe(
      true,
    );
    expect(results.every((r) => r.matchedIn === "breadcrumb")).toBe(true);
  });

  it("returns nothing for a query with no match", () => {
    expect(search(buildSearchIndex(document), "nope")).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(search(buildSearchIndex(document), "   ")).toEqual([]);
  });

  it("indexes an empty object's own breadcrumb without descending into non-existent children", () => {
    const results = search(buildSearchIndex(document), "empty");
    expect(results.map((r) => r.path)).toEqual([["empty"]]);
  });
});
