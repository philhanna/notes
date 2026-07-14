import { describe, expect, it } from "vitest";
import { findRelevantRevisions } from "./history.ts";
import { createInMemoryRepository } from "../persistence/inMemoryRepository.ts";
import type { Repository, CommitInfo } from "../persistence/repository.ts";
import { ok } from "../domain/result.ts";
import type { JsonObject } from "../domain/types.ts";
import type { PersistError } from "../persistence/types.ts";
import type { Result } from "../domain/result.ts";

describe("findRelevantRevisions", () => {
  it("finds only the revisions where the given path actually changed", async () => {
    const repository = createInMemoryRepository({
      initialDocument: { tips: { bash: "old" }, other: 1 },
    });
    const loaded = await repository.loadDocument();
    if (!loaded.ok) throw new Error("expected loadDocument to succeed");

    // Changes an unrelated key — should not show up in /tips/bash history.
    const unrelated = await repository.save(
      {
        document: { tips: { bash: "old" }, other: 2 },
        trash: loaded.value.trash,
      },
      loaded.value.sha,
      { kind: "set-value", path: ["other"] },
    );
    if (!unrelated.ok) throw new Error("expected save to succeed");

    const relevant1 = await repository.save(
      {
        document: { tips: { bash: "new" }, other: 2 },
        trash: loaded.value.trash,
      },
      unrelated.value.sha,
      { kind: "set-value", path: ["tips", "bash"] },
    );
    if (!relevant1.ok) throw new Error("expected save to succeed");

    const result = await findRelevantRevisions(repository, ["tips", "bash"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const shas = result.value.map((r) => r.sha);
      expect(shas).toContain(relevant1.value.sha);
      expect(shas).not.toContain(unrelated.value.sha);
    }
  });

  it("reports the value at the path as of each relevant revision, newest first", async () => {
    const repository = createInMemoryRepository({
      initialDocument: { note: "v1" },
    });
    const loaded = await repository.loadDocument();
    if (!loaded.ok) throw new Error("expected loadDocument to succeed");

    const second = await repository.save(
      { document: { note: "v2" }, trash: loaded.value.trash },
      loaded.value.sha,
      { kind: "set-value", path: ["note"] },
    );
    if (!second.ok) throw new Error("expected save to succeed");

    const third = await repository.save(
      { document: { note: "v3" }, trash: loaded.value.trash },
      second.value.sha,
      { kind: "set-value", path: ["note"] },
    );
    if (!third.ok) throw new Error("expected save to succeed");

    const result = await findRelevantRevisions(repository, ["note"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.value)).toEqual(["v3", "v2", "v1"]);
      expect(result.value[0]!.sha).toBe(third.value.sha);
    }
  });

  it("always includes the oldest revision in a page, since there is no fetched predecessor to compare it to", async () => {
    const repository = createInMemoryRepository({
      initialDocument: { note: "only ever this value" },
    });
    const result = await findRelevantRevisions(repository, ["note"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("returns an empty list when nothing has ever touched remember.json", async () => {
    const repository = createInMemoryRepository();
    const result = await findRelevantRevisions(repository, ["note"]);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("propagates a loadDocumentAt failure instead of silently dropping revisions", async () => {
    const failing: Repository = {
      checkRepository: async () =>
        ok({ private: true, writable: true, defaultBranch: "main" }),
      ensureDocument: async () => {
        throw new Error("not used");
      },
      loadDocument: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listDocumentHistory: async (): Promise<
        Result<CommitInfo[], PersistError>
      > =>
        ok([
          { sha: "a", message: "Set /note", date: "2026-01-01T00:00:00.000Z" },
          { sha: "b", message: "Set /note", date: "2026-01-01T00:01:00.000Z" },
        ]),
      loadDocumentAt: async (
        sha: string,
      ): Promise<Result<JsonObject, PersistError>> =>
        sha === "a"
          ? ok({ note: "v2" })
          : { ok: false, error: { kind: "network" } },
    };

    const result = await findRelevantRevisions(failing, ["note"]);
    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("bounds concurrent loadDocumentAt calls", async () => {
    const commits: CommitInfo[] = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha-${i}`,
      message: "Set /note",
      date: `2026-01-01T00:0${i}:00.000Z`,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const tracking: Repository = {
      checkRepository: async () =>
        ok({ private: true, writable: true, defaultBranch: "main" }),
      ensureDocument: async () => {
        throw new Error("not used");
      },
      loadDocument: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listDocumentHistory: async (): Promise<
        Result<CommitInfo[], PersistError>
      > => ok(commits),
      loadDocumentAt: async (
        sha: string,
      ): Promise<Result<JsonObject, PersistError>> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return ok({ note: sha });
      },
    };

    await findRelevantRevisions(tracking, ["note"], { concurrency: 3 });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
