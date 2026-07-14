import type { RepoConfig } from "../auth/repoConfig.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { githubFetch } from "./githubApi.ts";
import type { PersistError } from "./types.ts";

/**
 * Thin wrappers over the Git Data API's blob/tree/commit/ref objects
 * (design.md "Use the Git Data API for multi-file writes"), proven by
 * `spikes/02-atomic-commit.mjs`/`spikes/03-stale-writer.mjs`. Each call maps
 * failures through the shared `githubFetch` error mapping, so a rejected
 * ref update (fast-forward failure) already comes back as `conflict`,
 * distinguishable from `unauthorized`, without any new mapping code here.
 * `githubRepository.ts` is the only caller — this module knows nothing
 * about `remember.json`/`.trash/trash.json` specifically.
 */

export interface TreeEntry {
  path: string;
  sha: string;
}

export async function getHeadCommitSha(
  config: RepoConfig,
  accessToken: string,
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`,
    accessToken,
  );
  if (!result.ok) return result;
  const sha = (result.value.body as { object?: { sha?: string } }).object?.sha;
  if (typeof sha !== "string") return err({ kind: "malformed" });
  return ok(sha);
}

export async function getCommitTreeSha(
  config: RepoConfig,
  accessToken: string,
  commitSha: string,
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/commits/${commitSha}`,
    accessToken,
  );
  if (!result.ok) return result;
  const sha = (result.value.body as { tree?: { sha?: string } }).tree?.sha;
  if (typeof sha !== "string") return err({ kind: "malformed" });
  return ok(sha);
}

/** Lists every blob path in the tree at `treeSha` (`?recursive=1`), one consistent snapshot. */
export async function getTreeEntries(
  config: RepoConfig,
  accessToken: string,
  treeSha: string,
): Promise<Result<TreeEntry[], PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/trees/${treeSha}?recursive=1`,
    accessToken,
  );
  if (!result.ok) return result;
  const tree = (result.value.body as { tree?: unknown }).tree;
  if (!Array.isArray(tree)) return err({ kind: "malformed" });

  const entries: TreeEntry[] = [];
  for (const item of tree as unknown[]) {
    const entry = item as { path?: unknown; sha?: unknown; type?: unknown };
    if (entry.type !== "blob") continue;
    if (typeof entry.path !== "string" || typeof entry.sha !== "string") {
      return err({ kind: "malformed" });
    }
    entries.push({ path: entry.path, sha: entry.sha });
  }
  return ok(entries);
}

export async function getBlobText(
  config: RepoConfig,
  accessToken: string,
  blobSha: string,
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/blobs/${blobSha}`,
    accessToken,
  );
  if (!result.ok) return result;
  const content = (result.value.body as { content?: unknown }).content;
  if (typeof content !== "string") return err({ kind: "malformed" });
  return ok(decodeBase64(content));
}

export async function createBlob(
  config: RepoConfig,
  accessToken: string,
  content: string,
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/blobs`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        content: encodeBase64(content),
        encoding: "base64",
      }),
    },
  );
  if (!result.ok) return result;
  const sha = (result.value.body as { sha?: unknown }).sha;
  if (typeof sha !== "string") return err({ kind: "malformed" });
  return ok(sha);
}

/** `baseTreeSha` is omitted for the very first commit of a brand-new, commit-less repository. */
export async function createTree(
  config: RepoConfig,
  accessToken: string,
  baseTreeSha: string | undefined,
  entries: TreeEntry[],
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/trees`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
        tree: entries.map((entry) => ({
          path: entry.path,
          mode: "100644",
          type: "blob",
          sha: entry.sha,
        })),
      }),
    },
  );
  if (!result.ok) return result;
  const sha = (result.value.body as { sha?: unknown }).sha;
  if (typeof sha !== "string") return err({ kind: "malformed" });
  return ok(sha);
}

/** `parentSha` is `null` only for the very first commit of a brand-new, commit-less repository. */
export async function createCommit(
  config: RepoConfig,
  accessToken: string,
  message: string,
  treeSha: string,
  parentSha: string | null,
): Promise<Result<string, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/commits`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
      }),
    },
  );
  if (!result.ok) return result;
  const sha = (result.value.body as { sha?: unknown }).sha;
  if (typeof sha !== "string") return err({ kind: "malformed" });
  return ok(sha);
}

/** Advances an existing branch ref conditionally (`force: false`); a rejected fast-forward maps to `conflict`. */
export async function updateRef(
  config: RepoConfig,
  accessToken: string,
  commitSha: string,
): Promise<Result<void, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: false }),
    },
  );
  if (!result.ok) return result;
  return ok(undefined);
}

/**
 * Creates the branch ref for the first time — only reachable when a
 * brand-new repository has zero commits, so `git/ref/heads/{branch}` 404s
 * and there is no existing ref to PATCH.
 */
export async function createRef(
  config: RepoConfig,
  accessToken: string,
  commitSha: string,
): Promise<Result<void, PersistError>> {
  const result = await githubFetch(
    `/repos/${config.owner}/${config.repo}/git/refs`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${config.branch}`,
        sha: commitSha,
      }),
    },
  );
  if (!result.ok) return result;
  return ok(undefined);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
