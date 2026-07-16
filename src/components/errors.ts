import type { MutationError } from "../app/useDocument.ts";
import { encodePointer } from "../domain/path.ts";
import type { TreeError } from "../domain/tree.ts";
import type { Path } from "../domain/types.ts";
import type { PersistError } from "../persistence/types.ts";

/** User-facing messages for domain errors, shown without losing input (design.md 6.1). */
export function describeTreeError(error: TreeError): string {
  switch (error.kind) {
    case "not-found":
      return "That location no longer exists.";
    case "not-object":
      return "That location cannot hold named entries.";
    case "not-array":
      return "That location is not a list.";
    case "not-container":
      return "That location has no children.";
    case "empty-key":
      return "A key is required.";
    case "duplicate-key":
      return `"${error.key}" already exists here (keys are case-insensitive).`;
    case "index-out-of-range":
      return "That position is out of range.";
    case "confirmation-required":
      return "This replacement changes the value's type and requires confirmation.";
    case "cannot-delete-root":
      return "The whole document cannot be deleted.";
    case "cannot-move-root":
      return "The whole document cannot be moved.";
    case "cannot-move-into-descendant":
      return "A container cannot be moved into itself or one of its contents.";
  }
}

/** User-facing messages for save failures, shown without losing input (design.md 13). */
export function describePersistError(error: PersistError): string {
  switch (error.kind) {
    case "network":
      return "Could not reach GitHub. Check your connection and try again.";
    case "rate-limit":
      return "GitHub's rate limit was reached. Try again shortly.";
    case "unauthorized":
      return "Your sign-in has expired. Sign in again to save.";
    case "forbidden":
      return "This repository is not writable with the current authorization.";
    case "not-found":
      return "The document could not be found in the repository.";
    case "conflict":
      return "Someone else saved a newer version. Reload and try again.";
    case "malformed":
      return "The repository's document could not be read.";
  }
}

/**
 * User-facing message for an overlapping-conflict MutationError (design.md
 * 7.4, Phase 4). Local state has already been refreshed to the latest saved
 * revision by the time this is shown, so it asks for a review and an
 * explicit retry rather than "reload" — names only the changed locations,
 * never note content.
 */
export function describeConflictError(error: {
  documentChanged: Path[];
}): string {
  const changed =
    error.documentChanged.length > 0
      ? error.documentChanged.map((path) => encodePointer(path)).join(", ")
      : "this data";
  return `Someone else changed ${changed} since you loaded it. The view has been refreshed — review and try again.`;
}

/** Dispatches to the right description for a mutator's tagged MutationError. */
export function describeError(error: MutationError): string {
  switch (error.source) {
    case "domain":
      return describeTreeError(error.error);
    case "persist":
      return describePersistError(error.error);
    case "conflict":
      return describeConflictError(error);
  }
}
