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
    ).toEqual(["hardinfo", "list", "tips"]);
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

  it("moves an entry to a new parent", async () => {
    const { result } = renderHook(() => useDocument(sample()));
    await act(async () => {
      const outcome = await result.current.move(["hardinfo"], ["tips"]);
      expect(outcome.ok).toBe(true);
    });
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "hardinfo",
      ),
    ).toBe(false);
    act(() => result.current.navigate(["tips"]));
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "hardinfo",
      ),
    ).toBe(true);
  });

  it("copies an entry, leaving the original in place", async () => {
    const { result } = renderHook(() => useDocument(sample()));
    await act(async () => {
      const outcome = await result.current.copy(["hardinfo"], ["tips"], "copy");
      expect(outcome.ok).toBe(true);
    });
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "hardinfo",
      ),
    ).toBe(true);
    act(() => result.current.navigate(["tips"]));
    expect(
      result.current.children.some(
        (c) => c.kind === "object-entry" && c.key === "copy",
      ),
    ).toBe(true);
  });

  describe("delete", () => {
    it("permanently removes an entry from the active tree", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        const outcome = await result.current.deleteEntry(["hardinfo"]);
        expect(outcome.ok).toBe(true);
      });
      expect(
        result.current.children.some(
          (c) => c.kind === "object-entry" && c.key === "hardinfo",
        ),
      ).toBe(false);
    });

    it("rejects deleting the document root", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        const outcome = await result.current.deleteEntry([]);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error).toEqual({
            source: "domain",
            error: { kind: "cannot-delete-root" },
          });
        }
      });
    });
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

    it("automatically reapplies a stale write when nothing actually changed underneath (Phase 4)", async () => {
      // The hook's initialSha wasn't the repository's real starting sha — a
      // mismatch that never reflected an actual concurrent change. Reloading
      // finds the content identical, so the disjoint-reapply path (design.md
      // 7.4) resolves it without surfacing an error.
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: "stale-sha" }),
      );

      await act(async () => {
        const outcome = await result.current.setValue(["hardinfo"], "updated");
        expect(outcome.ok).toBe(true);
      });

      expect(repository.commits).toHaveLength(1);
      const child = result.current.children.find(
        (c) => c.kind === "object-entry" && c.key === "hardinfo",
      );
      expect(child).toMatchObject({ value: "updated" });
    });

    it("reapplies a disjoint concurrent edit and succeeds (Phase 4 exit criterion)", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const baseSha = "sha-0";
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: baseSha }),
      );

      // Simulate a second device committing an unrelated change first.
      await repository.save(
        { document: { ...sample(), list: [9, 9, 9] } },
        baseSha,
        { kind: "set-value", path: ["list"] },
      );

      await act(async () => {
        const outcome = await result.current.setValue(["hardinfo"], "updated");
        expect(outcome.ok).toBe(true);
      });

      expect(repository.commits).toHaveLength(2);
      const document = repository.commits[1]!.document;
      expect(document.hardinfo).toBe("updated");
      expect(document.list).toEqual([9, 9, 9]); // the other device's disjoint edit survived the reapply
    });

    it("stops an overlapping concurrent edit with a conflict error and refreshed, recoverable local state", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const baseSha = "sha-0";
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: baseSha }),
      );

      // Simulate a second device changing the very key this hook is about to edit.
      await repository.save(
        { document: { ...sample(), hardinfo: "changed elsewhere" } },
        baseSha,
        { kind: "set-value", path: ["hardinfo"] },
      );

      await act(async () => {
        const outcome = await result.current.setValue(
          ["hardinfo"],
          "my update",
        );
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error.source).toBe("conflict");
          if (outcome.error.source === "conflict") {
            expect(outcome.error.documentChanged).toEqual([["hardinfo"]]);
          }
        }
      });

      // Local state was refreshed to the latest saved revision, not left stale.
      const child = result.current.children.find(
        (c) => c.kind === "object-entry" && c.key === "hardinfo",
      );
      expect(child).toMatchObject({ value: "changed elsewhere" });
      // No duplicate/extra commit was made for the losing attempt.
      expect(repository.commits).toHaveLength(1);
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

    it("commits a permanent delete", async () => {
      const repository = createInMemoryRepository({
        initialDocument: sample(),
      });
      const { result } = renderHook(() =>
        useDocument(sample(), { repository, initialSha: "sha-0" }),
      );

      await act(async () => {
        const outcome = await result.current.deleteEntry(["hardinfo"]);
        expect(outcome.ok).toBe(true);
      });

      expect(repository.commits).toHaveLength(1);
      expect(repository.commits[0]?.message).toBe("Delete /hardinfo");
      expect(repository.commits[0]?.document).not.toHaveProperty("hardinfo");
    });
  });
});
