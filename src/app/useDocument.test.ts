import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDocument } from "./useDocument.ts";
import type { JsonObject } from "../domain/types.ts";
import { createInMemoryRepository } from "../persistence/inMemoryRepository.ts";

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

  it("creates an entry at the current level and re-renders children", async () => {
    const { result } = renderHook(() => useDocument(sample()));
    await act(async () => {
      const outcome = await result.current.createEntry("new-key", "new value");
      expect(outcome.ok).toBe(true);
    });
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "new-key",
      ),
    ).toBe(true);
  });

  it("reports a domain error without mutating state", async () => {
    const { result } = renderHook(() => useDocument(sample()));
    const before = result.current.document;
    await act(async () => {
      const outcome = await result.current.createEntry("", "value");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.source).toBe("domain");
    });
    expect(result.current.document).toBe(before);
  });

  it("reorders array elements", async () => {
    const { result } = renderHook(() => useDocument(sample()));
    act(() => result.current.navigate(["list"]));
    await act(async () => {
      const outcome = await result.current.reorder(0, 2);
      expect(outcome.ok).toBe(true);
    });
    expect(result.current.children.map((c) => c.value)).toEqual([2, 3, 1]);
  });

  describe("with persistence", () => {
    it("commits a successful mutation and advances the sha", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: "sha-0" }),
      );

      await act(async () => {
        const outcome = await result.current.createEntry(
          "new-key",
          "new value",
        );
        expect(outcome.ok).toBe(true);
      });

      expect(repository.commits).toHaveLength(1);
      expect(repository.commits[0]?.message).toBe("Create /new-key");
      expect(
        result.current.children.some(
          (c) => c.kind === "object-entry" && c.key === "new-key",
        ),
      ).toBe(true);
    });

    it("leaves the document unchanged and reports a persist error on a stale sha", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: "stale-sha" }),
      );
      const before = result.current.document;

      await act(async () => {
        const outcome = await result.current.setValue(["hardinfo"], "updated");
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error).toEqual({
            source: "persist",
            error: { kind: "conflict" },
          });
        }
      });

      expect(result.current.document).toBe(before);
      expect(repository.commits).toHaveLength(0);
    });

    it("does not call the repository when domain validation fails first", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: "sha-0" }),
      );

      await act(async () => {
        const outcome = await result.current.createEntry("", "value");
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error.source).toBe("domain");
      });

      expect(repository.commits).toHaveLength(0);
    });
  });
});
