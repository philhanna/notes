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
  | { kind: "reorder"; path: Path };

export interface RepositoryCheck {
  private: boolean;
  writable: boolean;
  defaultBranch: string;
}

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
  /** Conditional on `baseSha`; a stale `baseSha` fails with a `conflict` PersistError. */
  saveDocument(
    document: JsonObject,
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>>;
}
