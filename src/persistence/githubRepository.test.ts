import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubRepository } from "./githubRepository.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";

const config: RepoConfig = {
  owner: "philhanna",
  repo: "notes-data",
  branch: "main",
};

const okToken = async () => ({ ok: true as const, value: "test-token" });

function fakeResponse(
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
  it("decodes and parses the base64 file content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(
          "https://api.github.com/repos/philhanna/notes-data/contents/remember.json?ref=main",
        );
        return fakeResponse(200, {
          content: btoa(JSON.stringify({ hardinfo: "system info" }) + "\n"),
          sha: "abc123",
        });
      }),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.loadDocument();
    expect(result).toEqual({
      ok: true,
      value: { document: { hardinfo: "system info" }, sha: "abc123" },
    });
  });

  it("reports malformed when the stored content is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, { content: btoa("not json"), sha: "abc123" }),
      ),
    );

    const repository = createGithubRepository(config, okToken);
    expect(await repository.loadDocument()).toEqual({
      ok: false,
      error: { kind: "malformed" },
    });
  });

  it("reports not-found when the file is absent", async () => {
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
  it("leaves an existing document untouched", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () =>
      fakeResponse(200, {
        content: btoa(JSON.stringify({ hardinfo: "system info" }) + "\n"),
        sha: "abc123",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.ensureDocument();
    expect(result).toEqual({
      ok: true,
      value: { document: { hardinfo: "system info" }, sha: "abc123" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("creates remember.json only when absent", async () => {
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(fakeResponse(404, { message: "Not Found" }))
      .mockResolvedValueOnce(
        fakeResponse(201, { content: { sha: "new-sha" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.ensureDocument();
    expect(result).toEqual({
      ok: true,
      value: { document: {}, sha: "new-sha" },
    });

    const createCall = fetchMock.mock.calls[1];
    expect(createCall?.[1]?.method).toBe("PUT");
    const body = JSON.parse(createCall?.[1]?.body as string);
    expect(body.sha).toBeUndefined();
    expect(JSON.parse(atob(body.content))).toEqual({});
  });
});

describe("saveDocument", () => {
  it("PUTs the serialized document conditional on baseSha", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () => fakeResponse(200, { content: { sha: "new-sha" } }));
    vi.stubGlobal("fetch", fetchMock);

    const repository = createGithubRepository(config, okToken);
    const result = await repository.saveDocument(
      { "where-was-i": "here" },
      "old-sha",
      { kind: "set-value", path: ["where-was-i"] },
    );

    expect(result).toEqual({ ok: true, value: { sha: "new-sha" } });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "https://api.github.com/repos/philhanna/notes-data/contents/remember.json",
    );
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body.sha).toBe("old-sha");
    expect(body.message).toBe("Set /where-was-i");
    expect(JSON.parse(atob(body.content))).toEqual({ "where-was-i": "here" });
  });

  it("reports conflict on a stale sha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(409, { message: "sha mismatch" })),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.saveDocument({ a: 1 }, "stale-sha", {
      kind: "set-value",
      path: ["a"],
    });
    expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
  });

  it("reports rate-limit distinctly from a generic forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(
          403,
          { message: "rate limited" },
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" },
        ),
      ),
    );

    const repository = createGithubRepository(config, okToken);
    const result = await repository.saveDocument({ a: 1 }, "sha", {
      kind: "set-value",
      path: ["a"],
    });
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
    const result = await repository.saveDocument({ a: 1 }, "sha", {
      kind: "set-value",
      path: ["a"],
    });
    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });
});
