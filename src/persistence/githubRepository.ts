import type { AuthError } from "../auth/types.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { parseDocument, serializeDocument } from "../domain/serialize.ts";
import type { JsonObject } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { describeOperation } from "./commitMessage.ts";
import { githubFetch } from "./githubApi.ts";
import type {
  LoadedDocument,
  Operation,
  Repository,
  RepositoryCheck,
} from "./repository.ts";
import type { PersistError } from "./types.ts";

const DOCUMENT_PATH = "remember.json";

interface ContentsResponseBody {
  content?: string;
  sha?: string;
}

interface RepoResponseBody {
  private?: boolean;
  default_branch?: string;
  permissions?: { push?: boolean };
}

/**
 * GitHub-backed Repository adapter (design.md 9). Uses the Contents API
 * only, since Phase 2 writes a single file (remember.json) and the
 * Contents API's conditional `sha` PUT is naturally atomic for that case
 * (proven in spikes 2/3). The Git Data API's multi-file atomic commit
 * becomes necessary once `.trash/trash.json` exists in Phase 3 (design.md
 * "Use the Git Data API for multi-file writes").
 */
export function createGithubRepository(
  config: RepoConfig,
  getAccessToken: () => Promise<Result<string, AuthError>>,
): Repository {
  async function withToken<T>(
    fn: (accessToken: string) => Promise<Result<T, PersistError>>,
  ): Promise<Result<T, PersistError>> {
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) return err({ kind: "unauthorized" });
    return fn(tokenResult.value);
  }

  async function checkRepository(): Promise<
    Result<RepositoryCheck, PersistError>
  > {
    return withToken(async (accessToken) => {
      const result = await githubFetch(
        `/repos/${config.owner}/${config.repo}`,
        accessToken,
      );
      if (!result.ok) return result;
      const body = result.value.body as RepoResponseBody;
      return ok({
        private: body.private === true,
        writable: body.permissions?.push === true,
        defaultBranch: String(body.default_branch),
      });
    });
  }

  async function loadDocument(): Promise<Result<LoadedDocument, PersistError>> {
    return withToken(async (accessToken) => {
      const result = await githubFetch(
        `/repos/${config.owner}/${config.repo}/contents/${DOCUMENT_PATH}?ref=${config.branch}`,
        accessToken,
      );
      if (!result.ok) return result;
      const body = result.value.body as ContentsResponseBody;
      if (typeof body.content !== "string" || typeof body.sha !== "string") {
        return err({ kind: "malformed" });
      }
      const parsed = parseDocument(decodeBase64(body.content));
      if (!parsed.ok) return err({ kind: "malformed" });
      return ok({ document: parsed.value, sha: body.sha });
    });
  }

  async function ensureDocument(): Promise<
    Result<LoadedDocument, PersistError>
  > {
    const existing = await loadDocument();
    if (existing.ok || existing.error.kind !== "not-found") return existing;
    return withToken(async (accessToken) => {
      const result = await githubFetch(
        `/repos/${config.owner}/${config.repo}/contents/${DOCUMENT_PATH}`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            message: "Initialize remember.json",
            content: encodeBase64(serializeDocument({})),
            branch: config.branch,
          }),
        },
      );
      if (!result.ok) return result;
      const sha = (result.value.body as { content?: ContentsResponseBody })
        .content?.sha;
      if (typeof sha !== "string") return err({ kind: "malformed" });
      return ok({ document: {}, sha });
    });
  }

  async function saveDocument(
    document: JsonObject,
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>> {
    return withToken(async (accessToken) => {
      const result = await githubFetch(
        `/repos/${config.owner}/${config.repo}/contents/${DOCUMENT_PATH}`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            message: describeOperation(operation),
            content: encodeBase64(serializeDocument(document)),
            sha: baseSha,
            branch: config.branch,
          }),
        },
      );
      if (!result.ok) return result;
      const sha = (result.value.body as { content?: ContentsResponseBody })
        .content?.sha;
      if (typeof sha !== "string") return err({ kind: "malformed" });
      return ok({ sha });
    });
  }

  return { checkRepository, ensureDocument, loadDocument, saveDocument };
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
