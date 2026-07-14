import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubRepository } from "./githubRepository.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import type { TrashDocument } from "../domain/trash.ts";
import {
  createFakeGraph,
  fakeResponse,
  installFetch,
} from "../test/fakeGitGraph.ts";

const config: RepoConfig = {
  owner: "philhanna",
  repo: "notes-data",
  branch: "main",
};

const okToken = async () => ({ ok: true as const, value: "test-token" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkRepository", () => {
  it("reports private/writable status and the default branch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("https://api.github.com/repos/philhanna/notes-data");
        return fakeResponse(200, {
          private: true,
          default_branch: "main",
          permissions: { push: true },
        });
      }),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.checkRepository();
    expect(result).toEqual({
      ok: true,
      value: { private: true, writable: true, defaultBranch: "main" },
    });
  });

  it("reports not writable when push permission is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          private: true,
          default_branch: "main",
          permissions: { push: false },
        }),
      ),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.checkRepository();
    expect(result.ok && result.value.writable).toBe(false);
  });

  it("maps a 401 to unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(401, { message: "Bad credentials" })),
    );

    const repository = createGithubRepository(config, okToken);
    expect(await repository.checkRepository()).toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
  });

  it("short-circuits without calling fetch when getAccessToken fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const repository = createGithubRepository(config, async () => ({
      ok: false as const,
      error: { kind: "expired" as const },
    }));

    expect(await repository.checkRepository()).toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadDocument", () => {
  it("reads remember.json and defaults trash to empty when no trash file exists", async () => {
    const graph = createFakeGraph({ hardinfo: "system info" });
    installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.loadDocument();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.document).toEqual({ hardinfo: "system info" });
      expect(result.value.trash).toEqual({ version: 1, records: [] });
      expect(result.value.sha).toBe(graph.getHead());
    }
  });

  it("reads .trash/trash.json when it exists", async () => {
    const trash: TrashDocument = {
      version: 1,
      records: [
        {
          id: "t1",
          deletedAt: "2026-07-14T00:00:00.000Z",
          originalPath: "/gone",
          type: "string",
          value: "gone",
        },
      ],
    };
    const graph = createFakeGraph({ hardinfo: "system info" }, trash);
    installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.loadDocument();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trash).toEqual(trash);
  });

  it("reports malformed when remember.json content is not valid JSON", async () => {
    const graph = createFakeGraph({});
    // Overwrite the seeded remember.json blob with invalid content.
    const fetchMock = installFetch(graph);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.github.com", "");
      if (path.match(/\/git\/blobs\/blob-1$/)) {
        return fakeResponse(200, {
          content: btoa("not json"),
          encoding: "base64",
        });
      }
      return graph.handle(url, init);
    });

    const repository = createGithubRepository(config, okToken);
    expect(await repository.loadDocument()).toEqual({
      ok: false,
      error: { kind: "malformed" },
    });
  });

  it("reports malformed when a present trash file fails schema validation", async () => {
    const graph = createFakeGraph(
      { hardinfo: "x" },
      { version: 1, records: [] },
    );
    const fetchMock = installFetch(graph);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.github.com", "");
      if (path.match(/\/git\/blobs\/blob-2$/)) {
        return fakeResponse(200, {
          content: btoa(JSON.stringify({ version: 999, records: [] })),
          encoding: "base64",
        });
      }
      return graph.handle(url, init);
    });

    const repository = createGithubRepository(config, okToken);
    expect(await repository.loadDocument()).toEqual({
      ok: false,
      error: { kind: "malformed" },
    });
  });

  it("reports not-found when remember.json is absent from the tree", async () => {
    const graph = createFakeGraph(null);
    installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    expect(await repository.loadDocument()).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
  });

  it("reports not-found when the repository has no commits yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(404, { message: "Not Found" })),
    );

    const repository = createGithubRepository(config, okToken);
    expect(await repository.loadDocument()).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
  });
});

describe("ensureDocument", () => {
  it("leaves an existing document untouched, issuing no writes", async () => {
    const graph = createFakeGraph({ hardinfo: "system info" });
    const fetchMock = installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.ensureDocument();
    expect(result).toEqual({
      ok: true,
      value: {
        document: { hardinfo: "system info" },
        trash: { version: 1, records: [] },
        sha: graph.getHead(),
      },
    });
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
  });

  it("creates remember.json when the repo has commits but no remember.json yet", async () => {
    const graph = createFakeGraph(null);
    const fetchMock = installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.ensureDocument();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.document).toEqual({});
      expect(result.value.sha).toBe(graph.getHead());
    }
    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
  });

  it("creates the initial commit and ref when the repository has zero commits", async () => {
    const fetchMock = vi.fn();
    let blobCounter = 0;
    let treeSha: string | null = null;
    let commitSha: string | null = null;
    let refCreated = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.github.com", "");
      const method = (init?.method as string | undefined) ?? "GET";
      if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
        return fakeResponse(404, { message: "Not Found" });
      }
      if (method === "POST" && path.endsWith("/git/blobs")) {
        blobCounter += 1;
        return fakeResponse(201, { sha: `blob-${blobCounter}` });
      }
      if (method === "POST" && path.endsWith("/git/trees")) {
        const body = JSON.parse(init!.body as string) as { base_tree?: string };
        expect(body.base_tree).toBeUndefined();
        treeSha = "tree-1";
        return fakeResponse(201, { sha: treeSha });
      }
      if (method === "POST" && path.endsWith("/git/commits")) {
        const body = JSON.parse(init!.body as string) as { parents: string[] };
        expect(body.parents).toEqual([]);
        commitSha = "commit-1";
        return fakeResponse(201, { sha: commitSha });
      }
      if (method === "POST" && path.endsWith("/git/refs")) {
        const body = JSON.parse(init!.body as string) as {
          ref: string;
          sha: string;
        };
        expect(body.ref).toBe("refs/heads/main");
        expect(body.sha).toBe(commitSha);
        refCreated = true;
        return fakeResponse(201, { ref: body.ref, object: { sha: body.sha } });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.ensureDocument();
    expect(result).toEqual({
      ok: true,
      value: {
        document: {},
        trash: { version: 1, records: [] },
        sha: "commit-1",
      },
    });
    expect(refCreated).toBe(true);
  });
});

describe("save", () => {
  it("commits the serialized document conditional on baseSha, with a value-free message", async () => {
    const graph = createFakeGraph({ hardinfo: "old" });
    const fetchMock = installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const baseSha = graph.getHead()!;
    const result = await repository.save(
      {
        document: { "where-was-i": "here" },
        trash: { version: 1, records: [] },
      },
      baseSha,
      { kind: "set-value", path: ["where-was-i"] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sha).toBe(graph.getHead());

    const commitCall = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === "POST" &&
        (call[0] as string).endsWith("/git/commits"),
    );
    expect(commitCall).toBeDefined();
    const commitBody = JSON.parse(
      (commitCall![1] as RequestInit).body as string,
    ) as {
      message: string;
    };
    expect(commitBody.message).toBe("Set /where-was-i");

    const treeCall = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === "POST" &&
        (call[0] as string).endsWith("/git/trees"),
    );
    const treeBody = JSON.parse(
      (treeCall![1] as RequestInit).body as string,
    ) as {
      tree: { path: string; sha: string }[];
    };
    expect(treeBody.tree.map((e) => e.path)).toEqual(["remember.json"]);
  });

  it("includes .trash/trash.json in the commit when trash is non-empty", async () => {
    const graph = createFakeGraph({ hardinfo: "old" });
    const fetchMock = installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const baseSha = graph.getHead()!;
    const trash: TrashDocument = {
      version: 1,
      records: [
        {
          id: "t1",
          deletedAt: "2026-07-14T00:00:00.000Z",
          originalPath: "/gone",
          type: "string",
          value: "gone",
        },
      ],
    };
    const result = await repository.save(
      { document: { hardinfo: "old" }, trash },
      baseSha,
      { kind: "delete", path: ["gone"] },
    );
    expect(result.ok).toBe(true);

    const treeCall = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === "POST" &&
        (call[0] as string).endsWith("/git/trees"),
    );
    const treeBody = JSON.parse(
      (treeCall![1] as RequestInit).body as string,
    ) as {
      tree: { path: string; sha: string }[];
    };
    expect(treeBody.tree.map((e) => e.path).sort()).toEqual([
      ".trash/trash.json",
      "remember.json",
    ]);
  });

  it("omits .trash/trash.json when trash is empty and no trash file existed yet", async () => {
    const graph = createFakeGraph({ hardinfo: "old" });
    const fetchMock = installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const baseSha = graph.getHead()!;
    await repository.save(
      { document: { hardinfo: "new" }, trash: { version: 1, records: [] } },
      baseSha,
      { kind: "set-value", path: ["hardinfo"] },
    );

    const treeCall = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === "POST" &&
        (call[0] as string).endsWith("/git/trees"),
    );
    const treeBody = JSON.parse(
      (treeCall![1] as RequestInit).body as string,
    ) as {
      tree: { path: string; sha: string }[];
    };
    expect(treeBody.tree.map((e) => e.path)).toEqual(["remember.json"]);
  });

  it("reports conflict when the ref update is not a fast forward", async () => {
    const graph = createFakeGraph({ hardinfo: "old" });
    installFetch(graph);

    const repository = createGithubRepository(config, okToken);
    const baseSha = graph.getHead()!;
    const first = await repository.save(
      { document: { hardinfo: "first" }, trash: { version: 1, records: [] } },
      baseSha,
      { kind: "set-value", path: ["hardinfo"] },
    );
    expect(first.ok).toBe(true);

    const stale = await repository.save(
      { document: { hardinfo: "second" }, trash: { version: 1, records: [] } },
      baseSha,
      { kind: "set-value", path: ["hardinfo"] },
    );
    expect(stale).toEqual({ ok: false, error: { kind: "conflict" } });
  });

  it("reports rate-limit distinctly from a generic forbidden", async () => {
    const graph = createFakeGraph({ hardinfo: "old" });
    installFetch(graph, [
      {
        when: (url, init) =>
          ((init?.method as string | undefined) ?? "GET") === "GET" &&
          url.includes("/git/commits/"),
        respond: () =>
          fakeResponse(
            403,
            { message: "rate limited" },
            { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" },
          ),
      },
    ]);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.save(
      { document: { hardinfo: "new" }, trash: { version: 1, records: [] } },
      graph.getHead()!,
      { kind: "set-value", path: ["hardinfo"] },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "rate-limit", resetAt: 1_700_000_000_000 },
    });
  });

  it("reports network errors when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.save(
      { document: { a: 1 }, trash: { version: 1, records: [] } },
      "sha",
      { kind: "set-value", path: ["a"] },
    );
    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });

  // Phase 4 (design.md 7.4): "after an uncertain network response, reread
  // the branch head ... before retrying so the same user action does not
  // create duplicate commits." These three cases cover an uncertain outcome
  // specifically at the final ref-update step, where the response — not
  // necessarily the write itself — can be lost.
  describe("an uncertain ref-update outcome", () => {
    it("adopts the commit as successful when it landed but the response was lost", async () => {
      const graph = createFakeGraph({ hardinfo: "old" });
      const baseSha = graph.getHead()!;
      let patchAttempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = url.replace("https://api.github.com", "");
          const method = (init?.method as string | undefined) ?? "GET";
          if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
            patchAttempts += 1;
            await graph.handle(url, init); // the write really lands server-side...
            throw new TypeError("Failed to fetch"); // ...but the client never sees the response.
          }
          return graph.handle(url, init);
        }),
      );

      const repository = createGithubRepository(config, okToken);
      const result = await repository.save(
        { document: { hardinfo: "new" }, trash: { version: 1, records: [] } },
        baseSha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.sha).toBe(graph.getHead());
      expect(patchAttempts).toBe(1); // no duplicate write was attempted
    });

    it("reports the original network error when the write never reached the server", async () => {
      const graph = createFakeGraph({ hardinfo: "old" });
      const baseSha = graph.getHead()!;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = url.replace("https://api.github.com", "");
          const method = (init?.method as string | undefined) ?? "GET";
          if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
            throw new TypeError("Failed to fetch");
          }
          return graph.handle(url, init);
        }),
      );

      const repository = createGithubRepository(config, okToken);
      const result = await repository.save(
        { document: { hardinfo: "new" }, trash: { version: 1, records: [] } },
        baseSha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(result).toEqual({ ok: false, error: { kind: "network" } });
      expect(graph.getHead()).toBe(baseSha); // confirmed nothing landed
    });

    it("reports conflict, not a duplicate commit, when another write landed during the uncertain window", async () => {
      const graph = createFakeGraph({ hardinfo: "old" });
      const baseSha = graph.getHead()!;

      // A second device's write lands first, on the same base.
      installFetch(graph);
      const otherDevice = createGithubRepository(config, okToken);
      const otherResult = await otherDevice.save(
        {
          document: { hardinfo: "from another device" },
          trash: { version: 1, records: [] },
        },
        baseSha,
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(otherResult.ok).toBe(true);
      const headAfterOtherDevice = graph.getHead();

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = url.replace("https://api.github.com", "");
          const method = (init?.method as string | undefined) ?? "GET";
          if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
            throw new TypeError("Failed to fetch");
          }
          return graph.handle(url, init);
        }),
      );

      const repository = createGithubRepository(config, okToken);
      const result = await repository.save(
        {
          document: { hardinfo: "my update" },
          trash: { version: 1, records: [] },
        },
        baseSha, // the now-stale original base
        { kind: "set-value", path: ["hardinfo"] },
      );
      expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
      expect(graph.getHead()).toBe(headAfterOtherDevice); // the other device's write is still the only one that landed
    });
  });
});
