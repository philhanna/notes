import type { Path } from "../domain/types.ts";
import type { Operation } from "../persistence/repository.ts";

/**
 * The document and trash locations a given operation reads or writes, used
 * to decide whether a concurrent change from another device is disjoint
 * (safe to silently reapply) or overlapping (design.md 7.4, Phase 4).
 * `trash: "all"` means the operation is sensitive to any trash change
 * (Empty Trash removes every record, so no finer distinction is useful).
 *
 * `create-element` and `reorder` name the array itself rather than a
 * specific index: an index computed against the pre-reload document (for
 * example "append at the current length") is meaningless once the array
 * may have changed size, and `diff.ts`'s array comparison already reports
 * a whole changed array as its own path, so comparing at that granularity
 * is what actually lines up.
 */
export function affectedPaths(operation: Operation): {
  document: Path[];
  trash: string[] | "all";
} {
  switch (operation.kind) {
    case "create-entry":
      return { document: [operation.path], trash: [] };
    case "create-element":
      return { document: [operation.path.slice(0, -1)], trash: [] };
    case "rename":
      return { document: [operation.path, operation.newPath], trash: [] };
    case "set-value":
      return { document: [operation.path], trash: [] };
    case "reorder":
      return { document: [operation.path], trash: [] };
    case "move":
      return { document: [operation.path, operation.newPath], trash: [] };
    case "copy":
      return { document: [operation.path, operation.newPath], trash: [] };
    case "delete":
      return { document: [operation.path], trash: [] };
    case "recover":
      return { document: [operation.path], trash: [operation.trashId] };
    case "permanent-delete":
      return { document: [], trash: [operation.trashId] };
    case "empty-trash":
      return { document: [], trash: "all" };
  }
}
