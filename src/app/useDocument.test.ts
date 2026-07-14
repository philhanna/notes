import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDocument } from "./useDocument.ts";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "system info",
    tips: { bash: { fc: "recent history" } },
    list: [1, 2, 3],
  };
}

describe("useDocument", () => {
  it("lists children at the root", () => {
    const { result } = renderHook(() => useDocument(sample()));
    expect(
      result.current.children.map((c) =>
        c.kind === "object-entry" ? c.key : c.index,
      ),
    ).toEqual(["hardinfo", "tips", "list"]);
  });

  it("navigates into a container and updates children", () => {
    const { result } = renderHook(() => useDocument(sample()));
    act(() => result.current.navigate(["tips"]));
    expect(result.current.currentPath).toEqual(["tips"]);
    expect(result.current.children).toEqual([
      {
        kind: "object-entry",
        key: "bash",
        value: { fc: "recent history" },
        path: ["tips", "bash"],
      },
    ]);
  });

  it("creates an entry at the current level and re-renders children", () => {
    const { result } = renderHook(() => useDocument(sample()));
    act(() => {
      const outcome = result.current.createEntry("new-key", "new value");
      expect(outcome.ok).toBe(true);
    });
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "new-key",
      ),
    ).toBe(true);
  });

  it("reports a domain error without mutating state", () => {
    const { result } = renderHook(() => useDocument(sample()));
    const before = result.current.document;
    act(() => {
      const outcome = result.current.createEntry("", "value");
      expect(outcome.ok).toBe(false);
    });
    expect(result.current.document).toBe(before);
  });

  it("reorders array elements", () => {
    const { result } = renderHook(() => useDocument(sample()));
    act(() => result.current.navigate(["list"]));
    act(() => {
      const outcome = result.current.reorder(0, 2);
      expect(outcome.ok).toBe(true);
    });
    expect(result.current.children.map((c) => c.value)).toEqual([2, 3, 1]);
  });
});
