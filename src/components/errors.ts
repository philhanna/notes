import type { MutationError } from "../app/useDocument.ts";
import type { TreeError } from "../domain/tree.ts";
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
    case "trash-record-not-found":
      return "That trash item no longer exists.";
    case "destination-required":
      return "That location isn't available. Choose a different destination.";
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

/** Dispatches to the right description for a mutator's tagged MutationError. */
export function describeError(error: MutationError): string {
  return error.source === "domain"
    ? describeTreeError(error.error)
    : describePersistError(error.error);
}
