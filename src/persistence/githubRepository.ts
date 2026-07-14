import type { AuthError } from "../auth/types.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { parseDocument, serializeDocument } from "../domain/serialize.ts";
import { EMPTY_TRASH, parseTrash, serializeTrash } from "../domain/trash.ts";
import type { TrashDocument } from "../domain/trash.ts";
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
  LoadedDocument,
  Operation,
  Repository,
  RepositoryCheck,
} from "./repository.ts";
import type { PersistError } from "./types.ts";

const DOCUMENT_PATH = "remember.json";
const TRASH_PATH = ".trash/trash.json";

interface RepoResponseBody {
  private?: boolean;
  default_branch?: string;
  permissions?: { push?: boolean };
}

/**
 * GitHub-backed Repository adapter (design.md 9), using the Git Data API
 * (blob → tree → commit → ref) so remember.json and .trash/trash.json
 * always update as one atomic commit (design.md 7.3, 9; proven by
 * spikes/02-atomic-commit.mjs and spikes/03-stale-writer.mjs). `sha`
 * throughout this module is the branch head commit sha, not a file blob
 * sha — see repository.ts's LoadedDocument doc comment for why.
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

  /** Reads remember.json and .trash/trash.json from one consistent commit's tree, avoiding a torn read. */
  async function loadDocument(): Promise<Result<LoadedDocument, PersistError>> {
    return withToken(async (accessToken) => {
      const headResult = await getHeadCommitSha(config, accessToken);
      if (!headResult.ok) return headResult;
      const headSha = headResult.value;

      const treeShaResult = await getCommitTreeSha(
        config,
        accessToken,
        headSha,
      );
      if (!treeShaResult.ok) return treeShaResult;

      const entriesResult = await getTreeEntries(
        config,
        accessToken,
        treeShaResult.value,
      );
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

      // .trash/trash.json may not exist yet (a repo from before Phase 3, or
      // one that has never had a deletion) — that's an empty trash, not an error.
      const trashEntry = entries.find((entry) => entry.path === TRASH_PATH);
      let trash: TrashDocument = EMPTY_TRASH;
      if (trashEntry) {
        const trashTextResult = await getBlobText(
          config,
          accessToken,
          trashEntry.sha,
        );
        if (!trashTextResult.ok) return trashTextResult;
        const parsedTrash = parseTrash(trashTextResult.value);
        if (!parsedTrash.ok) return err({ kind: "malformed" });
        trash = parsedTrash.value;
      }

      return ok({ document: parsedDocument.value, trash, sha: headSha });
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
        return ok({
          document: {},
          trash: EMPTY_TRASH,
          sha: commitResult.value,
        });
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
      return ok({ document: {}, trash: EMPTY_TRASH, sha: commitResult.value });
    });
  }

  async function save(
    state: { document: JsonObject; trash: TrashDocument },
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

      const baseEntriesResult = await getTreeEntries(
        config,
        accessToken,
        baseTreeSha,
      );
      if (!baseEntriesResult.ok) return baseEntriesResult;
      const hadTrashFile = baseEntriesResult.value.some(
        (entry) => entry.path === TRASH_PATH,
      );

      const documentBlobResult = await createBlob(
        config,
        accessToken,
        serializeDocument(state.document),
      );
      if (!documentBlobResult.ok) return documentBlobResult;

      const entries: TreeEntry[] = [
        { path: DOCUMENT_PATH, sha: documentBlobResult.value },
      ];
      // Only writes .trash/trash.json once it's real content, or it already
      // existed — the file comes into existence lazily on the first delete,
      // with no separate migration step for repos created before Phase 3.
      if (hadTrashFile || state.trash.records.length > 0) {
        const trashBlobResult = await createBlob(
          config,
          accessToken,
          serializeTrash(state.trash),
        );
        if (!trashBlobResult.ok) return trashBlobResult;
        entries.push({ path: TRASH_PATH, sha: trashBlobResult.value });
      }

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

  return { checkRepository, ensureDocument, loadDocument, save };
}
