import { describe, expect, it } from "vitest";
import {
  describeConflictError,
  describeError,
  describePersistError,
  describeTreeError,
} from "./errors.ts";

describe("describeTreeError", () => {
  it("includes the offending key for a duplicate-key error", () => {
    expect(describeTreeError({ kind: "duplicate-key", key: "Home" })).toMatch(
      /"Home"/,
    );
  });
});

describe("describePersistError", () => {
  it("has a distinct message per kind", () => {
    const messages = new Set(
      [
        { kind: "network" as const },
        { kind: "rate-limit" as const, resetAt: null },
        { kind: "unauthorized" as const },
        { kind: "forbidden" as const },
        { kind: "not-found" as const },
        { kind: "conflict" as const },
        { kind: "malformed" as const },
      ].map(describePersistError),
    );
    expect(messages.size).toBe(7);
  });
});

describe("describeConflictError", () => {
  it("names the changed document paths without note values", () => {
    const message = describeConflictError({
      documentChanged: [["tips", "bash"]],
      trashChanged: [],
    });
    expect(message).toContain("/tips/bash");
  });

  it("names a trash change by count, not content", () => {
    const message = describeConflictError({
      documentChanged: [],
      trashChanged: ["t1", "t2"],
    });
    expect(message).toContain("2 trash items");
  });

  it("falls back to a generic phrase when nothing specific is known", () => {
    expect(
      describeConflictError({ documentChanged: [], trashChanged: [] }),
    ).toContain("this data");
  });
});

describe("describeError", () => {
  it("dispatches a domain-sourced error to describeTreeError", () => {
    expect(
      describeError({ source: "domain", error: { kind: "empty-key" } }),
    ).toBe(describeTreeError({ kind: "empty-key" }));
  });

  it("dispatches a persist-sourced error to describePersistError, even for a colliding kind name", () => {
    expect(
      describeError({ source: "persist", error: { kind: "not-found" } }),
    ).toBe(describePersistError({ kind: "not-found" }));
    expect(
      describeError({
        source: "domain",
        error: { kind: "not-found", path: [] },
      }),
    ).toBe(describeTreeError({ kind: "not-found", path: [] }));
  });

  it("dispatches a conflict-sourced error to describeConflictError", () => {
    const error = { documentChanged: [["a"]], trashChanged: [] };
    expect(describeError({ source: "conflict", ...error })).toBe(
      describeConflictError(error),
    );
  });
});
