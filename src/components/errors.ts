import type { TreeError } from "../domain/tree.ts";

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
  }
}
