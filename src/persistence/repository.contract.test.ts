import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "./repository.ts";
import { createInMemoryRepository } from "./inMemoryRepository.ts";
import { createGithubRepository } from "./githubRepository.ts";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** A fake api.github.com Contents endpoint backed by an in-memory document, so the
 * same contract cases below exercise the real request/response parsing in
 * githubRepository.ts, not just the in-memory fake's bookkeeping. */
function stubGithubTransport(initialDocument: Record<string, unknown>) {
  let document = initialDocument;
  let sha = "sha-0";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as {
          sha?: string;
          content: string;
        };
        if (body.sha !== sha) return fakeResponse(409, { message: "conflict" });
        document = JSON.parse(atob(body.content)) as Record<string, unknown>;
        sha = `sha-${Number(sha.split("-")[1]) + 1}`;
        return fakeResponse(200, { content: { sha } });
      }
      return fakeResponse(200, {
        content: btoa(JSON.stringify(document) + "\n"),
        sha,
      });
    }),
  );
}

/**
 * The same cases run against every Repository implementation (design.md 4:
 * "Persistence contract tests: run the same cases against the in-memory
 * fake and a mocked GitHub transport").
 */
function runContractTests(name: string, createRepository: () => Repository) {
  describe(name, () => {
    it("loads the initial document", async () => {
      const repository = createRepository();
      const result = await repository.loadDocument();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.document).toEqual({ hardinfo: "system info" });
      }
    });

    it("saves a change conditional on the loaded sha, and the change is visible on reload", async () => {
      const repository = createRepository();
      const loaded = await repository.loadDocument();
      if (!loaded.ok) throw new Error("expected loadDocument to succeed");

      const saved = await repository.saveDocument(
        { hardinfo: "updated" },
        loaded.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(saved.ok).toBe(true);

      const reloaded = await repository.loadDocument();
      expect(reloaded.ok).toBe(true);
      if (reloaded.ok) {
        expect(reloaded.value.document).toEqual({ hardinfo: "updated" });
      }
    });

    it("rejects a save against a stale sha with a conflict", async () => {
      const repository = createRepository();
      const saved = await repository.saveDocument(
        { hardinfo: "updated" },
        "not-the-real-sha",
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(saved).toEqual({ ok: false, error: { kind: "conflict" } });
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

runContractTests("inMemoryRepository", () =>
  createInMemoryRepository({ initialDocument: { hardinfo: "system info" } }),
);

runContractTests("githubRepository (mocked GitHub transport)", () => {
  stubGithubTransport({ hardinfo: "system info" });
  return createGithubRepository(
    { owner: "philhanna", repo: "notes-data", branch: "main" },
    async () => ({ ok: true, value: "test-token" }),
  );
});
