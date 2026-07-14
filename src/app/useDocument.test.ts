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

  describe("trash", () => {
    it("deletes an entry into trash and removes it from the active tree", async () => {
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
      expect(result.current.trash.records).toHaveLength(1);
      expect(result.current.trash.records[0]).toMatchObject({
        originalPath: "/hardinfo",
        type: "string",
        value: "system info",
      });
    });

    it("recovers a trash record to its original path", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        await result.current.deleteEntry(["hardinfo"]);
      });
      const trashId = result.current.trash.records[0]!.id;

      await act(async () => {
        const outcome = await result.current.recover(trashId);
        expect(outcome.ok).toBe(true);
      });
      expect(
        result.current.children.some(
          (c) => c.kind === "object-entry" && c.key === "hardinfo",
        ),
      ).toBe(true);
      expect(result.current.trash.records).toHaveLength(0);
    });

    it("requires an explicit destination when the original path is occupied", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        await result.current.deleteEntry(["hardinfo"]);
      });
      const trashId = result.current.trash.records[0]!.id;
      await act(async () => {
        await result.current.createEntry("hardinfo", "replacement");
      });

      await act(async () => {
        const outcome = await result.current.recover(trashId);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error).toEqual({
            source: "domain",
            error: { kind: "destination-required" },
          });
        }
      });

      await act(async () => {
        const outcome = await result.current.recover(trashId, {
          parentPath: ["tips"],
          key: "recovered",
        });
        expect(outcome.ok).toBe(true);
      });
      expect(result.current.trash.records).toHaveLength(0);
      act(() => result.current.navigate(["tips"]));
      expect(
        result.current.children.some(
          (c) => c.kind === "object-entry" && c.key === "recovered",
        ),
      ).toBe(true);
    });

    it("permanently deletes a trash record without restoring it", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        await result.current.deleteEntry(["hardinfo"]);
      });
      const trashId = result.current.trash.records[0]!.id;

      await act(async () => {
        const outcome = await result.current.permanentlyDeleteTrash(trashId);
        expect(outcome.ok).toBe(true);
      });
      expect(result.current.trash.records).toHaveLength(0);
      expect(
        result.current.children.some(
          (c) => c.kind === "object-entry" && c.key === "hardinfo",
        ),
      ).toBe(false);
    });

    it("empties all trash records", async () => {
      const { result } = renderHook(() => useDocument(sample()));
      await act(async () => {
        await result.current.deleteEntry(["hardinfo"]);
      });
      await act(async () => {
        await result.current.deleteEntry(["list"]);
      });
      expect(result.current.trash.records).toHaveLength(2);

      await act(async () => {
        const outcome = await result.current.emptyTrash();
        expect(outcome.ok).toBe(true);
      });
      expect(result.current.trash.records).toHaveLength(0);
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

    it("commits a delete's document and trash changes together, in one commit", async () => {
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
      expect(repository.commits[0]?.trash.records).toHaveLength(1);
      expect(result.current.trash.records).toHaveLength(1);
    });
  });
});
