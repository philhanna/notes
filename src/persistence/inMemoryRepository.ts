import { parseDocument, serializeDocument } from "../domain/serialize.ts";
import type { JsonObject } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { changedPaths } from "../domain/diff.ts";
import { describeOperation } from "./commitMessage.ts";
import type {
  CommitInfo,
  LoadedDocument,
  Operation,
  Repository,
  RepositoryCheck,
} from "./repository.ts";
import type { PersistError } from "./types.ts";

export interface InMemoryRepositoryOptions {
  initialDocument?: JsonObject;
  isPrivate?: boolean;
  writable?: boolean;
  defaultBranch?: string;
}

export interface InMemoryCommit {
  sha: string;
  message: string;
  document: JsonObject;
  date: string;
}

export interface InMemoryRepository extends Repository {
  commits: InMemoryCommit[];
}

/** An in-memory Repository fake for tests (design.md 4's "persistence contract tests"). */
export function createInMemoryRepository(
  options: InMemoryRepositoryOptions = {},
): InMemoryRepository {
  let document: JsonObject | null = options.initialDocument ?? null;
  let sha: string | null = document ? "sha-0" : null;
  let commitCount = 0;
  const commits: InMemoryCommit[] = [];

  function nextSha(): string {
    commitCount += 1;
    return `sha-${commitCount}`;
  }

  /** A deterministic fake clock, so tests don't depend on wall-clock timing. */
  function nextDate(): string {
    return new Date(Date.UTC(2026, 0, 1) + commitCount * 60_000).toISOString();
  }

  // A seeded initialDocument has no real mutation behind it (`commits` stays
  // exactly the log of this fake's own save/ensureDocument calls, which
  // other tests assert the length of), but listDocumentHistory/loadDocumentAt
  // still need something to find at its sha — matching a real repository,
  // where remember.json's creation is itself a queryable commit. Kept
  // separate from `commits` rather than seeded into it.
  const seedCommit: InMemoryCommit | null =
    document !== null && sha !== null
      ? {
          sha,
          message: "Initialize remember.json",
          document,
          date: nextDate(),
        }
      : null;

  function commitsForHistory(): InMemoryCommit[] {
    return seedCommit ? [seedCommit, ...commits] : commits;
  }

  async function checkRepository(): Promise<
    Result<RepositoryCheck, PersistError>
  > {
    return ok({
      private: options.isPrivate ?? true,
      writable: options.writable ?? true,
      defaultBranch: options.defaultBranch ?? "main",
    });
  }

  async function loadDocument(): Promise<Result<LoadedDocument, PersistError>> {
    if (document === null || sha === null) return err({ kind: "not-found" });
    return ok({ document, sha });
  }

  async function ensureDocument(): Promise<
    Result<LoadedDocument, PersistError>
  > {
    const existing = await loadDocument();
    if (existing.ok) return existing;
    document = {};
    sha = nextSha();
    commits.push({
      sha,
      message: "Initialize remember.json",
      document,
      date: nextDate(),
    });
    return ok({ document, sha });
  }

  async function save(
    state: { document: JsonObject },
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>> {
    if (sha !== baseSha) return err({ kind: "conflict" });
    const parsedDocument = parseDocument(serializeDocument(state.document));
    if (!parsedDocument.ok) return err({ kind: "malformed" });
    document = parsedDocument.value;
    sha = nextSha();
    commits.push({
      sha,
      message: describeOperation(operation),
      document,
      date: nextDate(),
    });
    return ok({ sha });
  }

  async function loadDocumentAt(
    targetSha: string,
  ): Promise<Result<JsonObject, PersistError>> {
    const commit = commitsForHistory().find(
      (candidate) => candidate.sha === targetSha,
    );
    if (!commit) return err({ kind: "not-found" });
    return ok(commit.document);
  }

  const HISTORY_PAGE_SIZE = 20;

  /**
   * Mirrors GitHub's commits-by-path listing (design.md 9): only commits
   * where remember.json's content actually changed from its predecessor,
   * newest first, one page at a time — see githubRepository.ts's
   * listDocumentHistory for why no further filtering is needed there.
   */
  async function listDocumentHistory(
    page = 1,
  ): Promise<Result<CommitInfo[], PersistError>> {
    const relevant: InMemoryCommit[] = [];
    let previous: JsonObject | undefined;
    for (const commit of commitsForHistory()) {
      if (
        previous === undefined ||
        changedPaths(previous, commit.document).length > 0
      ) {
        relevant.push(commit);
      }
      previous = commit.document;
    }
    const newestFirst = relevant.slice().reverse();
    const start = (page - 1) * HISTORY_PAGE_SIZE;
    return ok(
      newestFirst
        .slice(start, start + HISTORY_PAGE_SIZE)
        .map(({ sha: commitSha, message, date }) => ({
          sha: commitSha,
          message,
          date,
        })),
    );
  }

  return {
    checkRepository,
    ensureDocument,
    loadDocument,
    save,
    listDocumentHistory,
    loadDocumentAt,
    commits,
  };
}
