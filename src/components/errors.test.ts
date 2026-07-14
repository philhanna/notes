import { describe, expect, it } from "vitest";
import {
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
});
