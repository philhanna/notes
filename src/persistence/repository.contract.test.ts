import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "./repository.ts";
import { createInMemoryRepository } from "./inMemoryRepository.ts";
import { createGithubRepository } from "./githubRepository.ts";
import { serializeDocument } from "../domain/serialize.ts";
import type { JsonObject } from "../domain/types.ts";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const DOCUMENT_PATH = "remember.json";
const BRANCH = "main";

interface TreeNode {
  path: string;
  sha: string;
}

interface CommitNode {
  treeSha: string;
  parents: string[];
  message: string;
  date: string;
}

/**
 * A fake Git Data API backing store (blobs/trees/commits/a branch ref), so
 * the same contract cases below exercise githubRepository.ts's real
 * request/response handling — not just its own bookkeeping — the same way
 * the old single-endpoint Contents API stub did (design.md 4: "Persistence
 * contract tests: run the same cases against the in-memory fake and a
 * mocked GitHub transport"). Mirrors the object graph
 * spikes/02-atomic-commit.mjs and spikes/03-stale-writer.mjs proved against
 * the real API: PATCHing the ref only succeeds when the new commit's parent
 * matches the current head (a fast-forward), matching `force: false`.
 */
function stubGithubTransport(initialDocument: Record<string, unknown>) {
  const blobs = new Map<string, string>();
  const trees = new Map<string, TreeNode[]>();
  const commits = new Map<string, CommitNode>();
  const commitOrder: string[] = [];
  let head = "";
  let counter = 0;
  const nextSha = (prefix: string) => `${prefix}-${++counter}`;
  const nextDate = () =>
    new Date(Date.UTC(2026, 0, 1) + counter * 60_000).toISOString();

  const blobShaByContent = new Map<string, string>();
  /** Content-addressed, like real Git blobs — identical content reuses the same sha. */
  function putBlob(content: string): string {
    const existing = blobShaByContent.get(content);
    if (existing !== undefined) return existing;
    const sha = nextSha("blob");
    blobs.set(sha, content);
    blobShaByContent.set(content, sha);
    return sha;
  }

  function putTree(
    baseTreeSha: string | undefined,
    entries: TreeNode[],
  ): string {
    const merged = new Map<string, string>(
      (baseTreeSha ? (trees.get(baseTreeSha) ?? []) : []).map((entry) => [
        entry.path,
        entry.sha,
      ]),
    );
    for (const entry of entries) merged.set(entry.path, entry.sha);
    const sha = nextSha("tree");
    trees.set(
      sha,
      [...merged.entries()].map(([path, entrySha]) => ({
        path,
        sha: entrySha,
      })),
    );
    return sha;
  }

  function putCommit(
    treeSha: string,
    parents: string[],
    message = "initial commit",
  ): string {
    const sha = nextSha("commit");
    commits.set(sha, { treeSha, parents, message, date: nextDate() });
    commitOrder.push(sha);
    return sha;
  }

  // Seed the initial commit (and tree/blobs) matching what loadDocument expects to find.
  // Uses serializeDocument, not plain JSON.stringify, so a save that leaves
  // content logically unchanged reuses this same blob sha (real Git blobs
  // are content-addressed) instead of always minting a new one from a
  // differently-formatted byte string.
  const initialEntries: TreeNode[] = [
    {
      path: DOCUMENT_PATH,
      sha: putBlob(
        encodeBase64(serializeDocument(initialDocument as JsonObject)),
      ),
    },
  ];
  const initialTreeSha = putTree(undefined, initialEntries);
  head = putCommit(initialTreeSha, []);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.github.com", "");
      const method = init?.method ?? "GET";

      if (method === "GET" && path.endsWith(`/git/ref/heads/${BRANCH}`)) {
        return fakeResponse(200, { object: { sha: head } });
      }
      const commitMatch = /\/git\/commits\/([^/?]+)$/.exec(path);
      if (method === "GET" && commitMatch) {
        const commit = commits.get(commitMatch[1]!);
        if (!commit) return fakeResponse(404, { message: "Not Found" });
        return fakeResponse(200, { tree: { sha: commit.treeSha } });
      }
      const treeMatch = /\/git\/trees\/([^/?]+)/.exec(path);
      if (method === "GET" && treeMatch) {
        const entries = trees.get(treeMatch[1]!);
        if (!entries) return fakeResponse(404, { message: "Not Found" });
        return fakeResponse(200, {
          tree: entries.map((entry) => ({ ...entry, type: "blob" })),
        });
      }
      const blobMatch = /\/git\/blobs\/([^/?]+)$/.exec(path);
      if (method === "GET" && blobMatch) {
        const content = blobs.get(blobMatch[1]!);
        if (content === undefined)
          return fakeResponse(404, { message: "Not Found" });
        return fakeResponse(200, { content, encoding: "base64" });
      }
      if (
        method === "GET" &&
        path.startsWith("/repos/") &&
        path.includes("/commits?")
      ) {
        const query = new URLSearchParams(path.split("?")[1] ?? "");
        const filePath = query.get("path") ?? "";
        const perPage = Number(query.get("per_page") ?? "20");
        const page = Number(query.get("page") ?? "1");

        function blobShaAt(commitSha: string): string | undefined {
          const commit = commits.get(commitSha);
          if (!commit) return undefined;
          return trees.get(commit.treeSha)?.find((e) => e.path === filePath)
            ?.sha;
        }

        const relevant = commitOrder.filter((sha) => {
          const commit = commits.get(sha)!;
          const current = blobShaAt(sha);
          if (current === undefined) return false;
          const parentSha = commit.parents[0];
          const previous = parentSha ? blobShaAt(parentSha) : undefined;
          return current !== previous;
        });
        const start = (page - 1) * perPage;
        const results = relevant
          .slice()
          .reverse()
          .slice(start, start + perPage)
          .map((sha) => {
            const commit = commits.get(sha)!;
            return {
              sha,
              commit: {
                message: commit.message,
                author: { date: commit.date },
              },
            };
          });
        return fakeResponse(200, results);
      }
      if (method === "POST" && path.endsWith("/git/blobs")) {
        const body = JSON.parse(init!.body as string) as { content: string };
        return fakeResponse(201, { sha: putBlob(body.content) });
      }
      if (method === "POST" && path.endsWith("/git/trees")) {
        const body = JSON.parse(init!.body as string) as {
          base_tree?: string;
          tree: { path: string; sha: string }[];
        };
        return fakeResponse(201, {
          sha: putTree(
            body.base_tree,
            body.tree.map(({ path, sha }) => ({ path, sha })),
          ),
        });
      }
      if (method === "POST" && path.endsWith("/git/commits")) {
        const body = JSON.parse(init!.body as string) as {
          tree: string;
          parents: string[];
          message?: string;
        };
        return fakeResponse(201, {
          sha: putCommit(body.tree, body.parents, body.message),
        });
      }
      if (method === "PATCH" && path.endsWith(`/git/refs/heads/${BRANCH}`)) {
        const body = JSON.parse(init!.body as string) as { sha: string };
        const commit = commits.get(body.sha);
        if (!commit || commit.parents[0] !== head) {
          return fakeResponse(422, { message: "Update is not a fast forward" });
        }
        head = body.sha;
        return fakeResponse(200, { object: { sha: head } });
      }

      throw new Error(
        `stubGithubTransport: unhandled request ${method} ${path}`,
      );
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

      const saved = await repository.save(
        { document: { hardinfo: "updated" } },
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
      const loaded = await repository.loadDocument();
      if (!loaded.ok) throw new Error("expected loadDocument to succeed");

      const first = await repository.save(
        { document: { hardinfo: "first writer" } },
        loaded.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(first.ok).toBe(true);

      // A second writer, still holding the base sha the first writer just advanced past.
      const stale = await repository.save(
        { document: { hardinfo: "second writer" } },
        loaded.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(stale).toEqual({ ok: false, error: { kind: "conflict" } });
    });

    it("lists only commits where the document actually changed, newest first", async () => {
      const repository = createRepository();
      const loaded = await repository.loadDocument();
      if (!loaded.ok) throw new Error("expected loadDocument to succeed");

      // Content-addressed blobs mean re-saving the same document reuses the
      // same remember.json blob sha, so this commit changed nothing.
      const unchanged = await repository.save(
        { document: loaded.value.document },
        loaded.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      if (!unchanged.ok) throw new Error("expected unchanged save to succeed");

      const documentChange = await repository.save(
        { document: { hardinfo: "updated" } },
        unchanged.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      if (!documentChange.ok)
        throw new Error("expected document-change save to succeed");

      const history = await repository.listDocumentHistory();
      expect(history.ok).toBe(true);
      if (history.ok) {
        const shas = history.value.map((entry) => entry.sha);
        expect(shas[0]).toBe(documentChange.value.sha);
        expect(shas).not.toContain(unchanged.value.sha);
      }
    });

    it("reads the document as it existed at an earlier commit, without disturbing the current save", async () => {
      const repository = createRepository();
      const loaded = await repository.loadDocument();
      if (!loaded.ok) throw new Error("expected loadDocument to succeed");

      const saved = await repository.save(
        { document: { hardinfo: "updated" } },
        loaded.value.sha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      if (!saved.ok) throw new Error("expected save to succeed");

      const atOriginal = await repository.loadDocumentAt(loaded.value.sha);
      expect(atOriginal).toEqual({ ok: true, value: loaded.value.document });

      const current = await repository.loadDocument();
      expect(current.ok).toBe(true);
      if (current.ok)
        expect(current.value.document).toEqual({ hardinfo: "updated" });
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
