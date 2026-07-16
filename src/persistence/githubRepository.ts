import type { AuthError } from "../auth/types.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { parseDocument, serializeDocument } from "../domain/serialize.ts";
import type { JsonObject } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { describeOperation } from "./commitMessage.ts";
import { githubFetch } from "./githubApi.ts";
import type { TreeEntry } from "./gitDataApi.ts";
import {
  createBlob,
  createCommit,
  createRef,
  createTree,
  getBlobText,
  getCommitTreeSha,
  getHeadCommitSha,
  getTreeEntries,
  updateRef,
} from "./gitDataApi.ts";
import type {
  CommitInfo,
  LoadedDocument,
  Operation,
  Repository,
  RepositoryCheck,
} from "./repository.ts";
import type { PersistError } from "./types.ts";

const DOCUMENT_PATH = "remember.json";

interface RepoResponseBody {
  private?: boolean;
  default_branch?: string;
  permissions?: { push?: boolean };
}

/**
 * GitHub-backed Repository adapter (design.md 9), using the Git Data API
 * (blob → tree → commit → ref; proven by spikes/02-atomic-commit.mjs and
 * spikes/03-stale-writer.mjs). `sha` throughout this module is the branch
 * head commit sha, not a file blob sha — see repository.ts's LoadedDocument
 * doc comment for why.
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

  /** Reads every blob path at a commit's tree in one call, shared by loadDocument and loadDocumentAt/listDocumentHistory. */
  async function readTreeEntries(
    accessToken: string,
    commitSha: string,
  ): Promise<Result<TreeEntry[], PersistError>> {
    const treeShaResult = await getCommitTreeSha(
      config,
      accessToken,
      commitSha,
    );
    if (!treeShaResult.ok) return treeShaResult;
    return getTreeEntries(config, accessToken, treeShaResult.value);
  }

  /** Reads remember.json's content at a specific commit. */
  async function readDocumentAtCommit(
    accessToken: string,
    commitSha: string,
  ): Promise<Result<JsonObject, PersistError>> {
    const entriesResult = await readTreeEntries(accessToken, commitSha);
    if (!entriesResult.ok) return entriesResult;
    const documentEntry = entriesResult.value.find(
      (entry) => entry.path === DOCUMENT_PATH,
    );
    if (!documentEntry) return err({ kind: "not-found" });
    const documentTextResult = await getBlobText(
      config,
      accessToken,
      documentEntry.sha,
    );
    if (!documentTextResult.ok) return documentTextResult;
    const parsedDocument = parseDocument(documentTextResult.value);
    if (!parsedDocument.ok) return err({ kind: "malformed" });
    return ok(parsedDocument.value);
  }

  /** Reads remember.json from the current commit's tree. */
  async function loadDocument(): Promise<Result<LoadedDocument, PersistError>> {
    return withToken(async (accessToken) => {
      const headResult = await getHeadCommitSha(config, accessToken);
      if (!headResult.ok) return headResult;
      const headSha = headResult.value;

      const entriesResult = await readTreeEntries(accessToken, headSha);
      if (!entriesResult.ok) return entriesResult;
      const entries = entriesResult.value;

      const documentEntry = entries.find(
        (entry) => entry.path === DOCUMENT_PATH,
      );
      if (!documentEntry) return err({ kind: "not-found" });
      const documentTextResult = await getBlobText(
        config,
        accessToken,
        documentEntry.sha,
      );
      if (!documentTextResult.ok) return documentTextResult;
      const parsedDocument = parseDocument(documentTextResult.value);
      if (!parsedDocument.ok) return err({ kind: "malformed" });

      return ok({ document: parsedDocument.value, sha: headSha });
    });
  }

  async function loadDocumentAt(
    sha: string,
  ): Promise<Result<JsonObject, PersistError>> {
    return withToken((accessToken) => readDocumentAtCommit(accessToken, sha));
  }

  interface CommitListItem {
    sha?: unknown;
    commit?: { message?: unknown; author?: { date?: unknown } };
  }

  /**
   * GitHub's commits-by-path listing already only returns commits where
   * remember.json's blob actually changed (design.md 9's "list commits
   * affecting the data ... files") — the same filtering `git log -- path`
   * does — so no further per-commit fetch is needed just to build this
   * list. `page` supports design.md 11's "fetch historical versions
   * lazily": the caller only asks for another page once it needs one.
   */
  async function listDocumentHistory(
    page = 1,
  ): Promise<Result<CommitInfo[], PersistError>> {
    return withToken(async (accessToken) => {
      const result = await githubFetch(
        `/repos/${config.owner}/${config.repo}/commits?sha=${encodeURIComponent(config.branch)}&path=${encodeURIComponent(DOCUMENT_PATH)}&per_page=20&page=${page}`,
        accessToken,
      );
      if (!result.ok) return result;
      const body = result.value.body;
      if (!Array.isArray(body)) return err({ kind: "malformed" });

      const entries: CommitInfo[] = [];
      for (const item of body as CommitListItem[]) {
        const message = item.commit?.message;
        const date = item.commit?.author?.date;
        if (
          typeof item.sha !== "string" ||
          typeof message !== "string" ||
          typeof date !== "string"
        ) {
          return err({ kind: "malformed" });
        }
        entries.push({ sha: item.sha, message, date });
      }
      return ok(entries);
    });
  }

  async function ensureDocument(): Promise<
    Result<LoadedDocument, PersistError>
  > {
    const existing = await loadDocument();
    if (existing.ok || existing.error.kind !== "not-found") return existing;

    return withToken(async (accessToken) => {
      const blobResult = await createBlob(
        config,
        accessToken,
        serializeDocument({}),
      );
      if (!blobResult.ok) return blobResult;
      const entries: TreeEntry[] = [
        { path: DOCUMENT_PATH, sha: blobResult.value },
      ];

      const headResult = await getHeadCommitSha(config, accessToken);
      if (headResult.ok) {
        // The repository has commits, just not remember.json yet.
        const treeShaResult = await getCommitTreeSha(
          config,
          accessToken,
          headResult.value,
        );
        if (!treeShaResult.ok) return treeShaResult;
        const treeResult = await createTree(
          config,
          accessToken,
          treeShaResult.value,
          entries,
        );
        if (!treeResult.ok) return treeResult;
        const commitResult = await createCommit(
          config,
          accessToken,
          "Initialize remember.json",
          treeResult.value,
          headResult.value,
        );
        if (!commitResult.ok) return commitResult;
        const refResult = await updateRef(
          config,
          accessToken,
          commitResult.value,
        );
        if (!refResult.ok) return refResult;
        return ok({ document: {}, sha: commitResult.value });
      }

      // No commits at all yet — a brand-new repository created with no
      // initial README. There is no existing tree/ref to build on.
      if (headResult.error.kind !== "not-found") return headResult;
      const treeResult = await createTree(
        config,
        accessToken,
        undefined,
        entries,
      );
      if (!treeResult.ok) return treeResult;
      const commitResult = await createCommit(
        config,
        accessToken,
        "Initialize remember.json",
        treeResult.value,
        null,
      );
      if (!commitResult.ok) return commitResult;
      const refResult = await createRef(
        config,
        accessToken,
        commitResult.value,
      );
      if (!refResult.ok) return refResult;
      return ok({ document: {}, sha: commitResult.value });
    });
  }

  async function save(
    state: { document: JsonObject },
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>> {
    return withToken(async (accessToken) => {
      const treeShaResult = await getCommitTreeSha(
        config,
        accessToken,
        baseSha,
      );
      if (!treeShaResult.ok) return treeShaResult;
      const baseTreeSha = treeShaResult.value;

      const documentBlobResult = await createBlob(
        config,
        accessToken,
        serializeDocument(state.document),
      );
      if (!documentBlobResult.ok) return documentBlobResult;

      const entries: TreeEntry[] = [
        { path: DOCUMENT_PATH, sha: documentBlobResult.value },
      ];

      const treeResult = await createTree(
        config,
        accessToken,
        baseTreeSha,
        entries,
      );
      if (!treeResult.ok) return treeResult;
      const commitResult = await createCommit(
        config,
        accessToken,
        describeOperation(operation),
        treeResult.value,
        baseSha,
      );
      if (!commitResult.ok) return commitResult;
      const refResult = await updateRef(
        config,
        accessToken,
        commitResult.value,
      );
      if (refResult.ok) return ok({ sha: commitResult.value });
      if (refResult.error.kind !== "network") return refResult;

      // The ref update's outcome is uncertain (design.md 7.4, Phase 4:
      // "after an uncertain network response, reread the branch head ...
      // before retrying so the same user action does not create duplicate
      // commits"). The commit this attempt would have advanced the branch
      // to is already known locally (`commitResult.value`), so comparing it
      // against the current head settles whether the write actually landed
      // without needing a client-generated operation ID.
      const headAfter = await getHeadCommitSha(config, accessToken);
      if (!headAfter.ok) return refResult;
      if (headAfter.value === commitResult.value) {
        return ok({ sha: commitResult.value }); // it landed; only the response was lost
      }
      if (headAfter.value === baseSha) return refResult; // it never landed; safe to retry
      return err({ kind: "conflict" }); // someone else's write landed first
    });
  }

  return {
    checkRepository,
    ensureDocument,
    loadDocument,
    save,
    listDocumentHistory,
    loadDocumentAt,
  };
}
