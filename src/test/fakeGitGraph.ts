import { vi } from "vitest";
import type { TrashDocument } from "../domain/trash.ts";

export function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );
}

/**
 * A minimal in-memory Git object graph (blobs/trees/commits/one branch
 * ref), so a test can drive a whole loadDocument/ensureDocument/save call
 * chain realistically and then override just one endpoint to inject a
 * failure, instead of hand-sequencing every intermediate response. Shared
 * by githubRepository.test.ts and any component test that loads a document
 * through the real GitHub adapter (App.test.tsx, Setup.test.tsx), since all
 * of them drive the same Git Data API sequence (design.md 9).
 */
export function createFakeGraph(
  initialDocument: Record<string, unknown> | null,
  initialTrash?: TrashDocument,
) {
  const blobs = new Map<string, string>();
  const trees = new Map<string, { path: string; sha: string }[]>();
  const commits = new Map<string, { treeSha: string; parents: string[] }>();
  let head: string | null = null;
  let counter = 0;
  const nextSha = (prefix: string) => `${prefix}-${++counter}`;

  function putBlob(content: string): string {
    const sha = nextSha("blob");
    blobs.set(sha, content);
    return sha;
  }
  function putTree(
    baseTreeSha: string | undefined,
    entries: { path: string; sha: string }[],
  ): string {
    const merged = new Map<string, string>(
      (baseTreeSha ? (trees.get(baseTreeSha) ?? []) : []).map((e) => [
        e.path,
        e.sha,
      ]),
    );
    for (const entry of entries) merged.set(entry.path, entry.sha);
    const sha = nextSha("tree");
    trees.set(
      sha,
      [...merged.entries()].map(([path, s]) => ({ path, sha: s })),
    );
    return sha;
  }
  function putCommit(treeSha: string, parents: string[]): string {
    const sha = nextSha("commit");
    commits.set(sha, { treeSha, parents });
    return sha;
  }

  {
    const entries =
      initialDocument !== null
        ? [
            {
              path: "remember.json",
              sha: putBlob(encodeBase64(JSON.stringify(initialDocument))),
            },
          ]
        : [{ path: "README.md", sha: putBlob(encodeBase64("placeholder")) }];
    if (initialTrash) {
      entries.push({
        path: ".trash/trash.json",
        sha: putBlob(encodeBase64(JSON.stringify(initialTrash))),
      });
    }
    head = putCommit(putTree(undefined, entries), []);
  }

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const path = url.replace("https://api.github.com", "");
    const method = init?.method ?? "GET";

    if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      if (head === null) return fakeResponse(404, { message: "Not Found" });
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
      if (content === undefined) return fakeResponse(404, { message: "Not Found" });
      return fakeResponse(200, { content, encoding: "base64" });
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
        sha: putTree(body.base_tree, body.tree.map(({ path, sha }) => ({ path, sha }))),
      });
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      const body = JSON.parse(init!.body as string) as {
        tree: string;
        parents: string[];
      };
      return fakeResponse(201, { sha: putCommit(body.tree, body.parents) });
    }
    if (method === "POST" && path.endsWith("/git/refs")) {
      const body = JSON.parse(init!.body as string) as { ref: string; sha: string };
      if (head !== null) return fakeResponse(422, { message: "Reference already exists" });
      head = body.sha;
      return fakeResponse(201, { ref: body.ref, object: { sha: head } });
    }
    if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      const body = JSON.parse(init!.body as string) as { sha: string };
      const commit = commits.get(body.sha);
      if (!commit || commit.parents[0] !== head) {
        return fakeResponse(422, { message: "Update is not a fast forward" });
      }
      head = body.sha;
      return fakeResponse(200, { object: { sha: head } });
    }

    throw new Error(`createFakeGraph: unhandled request ${method} ${path}`);
  }

  return { handle, getHead: () => head, blobText: (sha: string) => blobs.get(sha) };
}

/** Routes to `graph` by default; `overrides` intercepts a matching call to inject a failure instead. */
export function installFetch(
  graph: ReturnType<typeof createFakeGraph>,
  overrides: { when: (url: string, init?: RequestInit) => boolean; respond: () => Response }[] = [],
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const override = overrides.find((o) => o.when(url, init));
    if (override) return override.respond();
    return graph.handle(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
