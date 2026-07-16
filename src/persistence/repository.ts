import type { JsonObject, Path } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import type { PersistError } from "./types.ts";

/**
 * A value-free description of a mutation, used only to generate a commit
 * message (design.md 9: "No note values are included in commit messages").
 */
export type Operation =
  | { kind: "create-entry"; path: Path }
  | { kind: "create-element"; path: Path }
  | { kind: "rename"; path: Path; newPath: Path }
  | { kind: "set-value"; path: Path }
  | { kind: "reorder"; path: Path }
  | { kind: "move"; path: Path; newPath: Path }
  | { kind: "copy"; path: Path; newPath: Path }
  | { kind: "delete"; path: Path }
  | { kind: "restore"; path: Path; revisionSha: string };

export interface RepositoryCheck {
  private: boolean;
  writable: boolean;
  defaultBranch: string;
}

/** One commit that changed remember.json, newest first (design.md 9, 10). */
export interface CommitInfo {
  sha: string;
  message: string;
  /** ISO 8601, from the commit's author date. */
  date: string;
}

/**
 * `sha` is the branch head commit sha (design.md 5.4), not a single file's
 * blob sha — it identifies a revision of the whole repository state
 * (`remember.json`), which is what `save`'s conflict detection needs.
 */
export interface LoadedDocument {
  document: JsonObject;
  sha: string;
}

/**
 * The port persistence adapters implement (design.md 9). Domain code and
 * components depend only on this, never on GitHub specifics directly, so
 * the same operations can run against `inMemoryRepository` in tests.
 */
export interface Repository {
  checkRepository(): Promise<Result<RepositoryCheck, PersistError>>;
  /** Creates remember.json only when absent (design.md 9.1); never overwrites it. */
  ensureDocument(): Promise<Result<LoadedDocument, PersistError>>;
  loadDocument(): Promise<Result<LoadedDocument, PersistError>>;
  /**
   * Commits `state.document` (design.md 9), conditional on `baseSha`; a
   * stale `baseSha` fails with a `conflict` PersistError.
   */
  save(
    state: { document: JsonObject },
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>>;
  /**
   * One page of commits that changed remember.json, newest first
   * (design.md 9's "list commits affecting the data ... files", 11's "fetch
   * historical versions lazily"). `page` is 1-based; a short page (or an
   * empty one) means there is nothing further back.
   */
  listDocumentHistory(
    page?: number,
  ): Promise<Result<CommitInfo[], PersistError>>;
  /** The document as it existed at `sha` (design.md 10's preview/restoration). */
  loadDocumentAt(sha: string): Promise<Result<JsonObject, PersistError>>;
}
