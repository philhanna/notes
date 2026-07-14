import type { JsonObject, Path } from "../domain/types.ts";
import type { TrashDocument } from "../domain/trash.ts";
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
  | { kind: "recover"; path: Path }
  | { kind: "permanent-delete"; path: Path }
  | { kind: "empty-trash" };

export interface RepositoryCheck {
  private: boolean;
  writable: boolean;
  defaultBranch: string;
}

/**
 * `sha` is the branch head commit sha (design.md 5.4), not a single file's
 * blob sha — it identifies a revision of the whole repository state
 * (`remember.json` and `.trash/trash.json` together), which is what
 * `save`'s conflict detection needs once a trash-only change must be
 * distinguishable from a stale document too.
 */
export interface LoadedDocument {
  document: JsonObject;
  trash: TrashDocument;
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
   * Commits `state.document` and `state.trash` together as one atomic
   * commit (design.md 7.3, 9), conditional on `baseSha`; a stale `baseSha`
   * fails with a `conflict` PersistError. Every mutation calls this, even
   * one that leaves `trash` unchanged, so `sha` always means "the whole
   * repo's revision."
   */
  save(
    state: { document: JsonObject; trash: TrashDocument },
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>>;
}
