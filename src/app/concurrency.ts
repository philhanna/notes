import type { Path } from "../domain/types.ts";
import type { Operation } from "../persistence/repository.ts";

/**
 * The document locations a given operation reads or writes, used to decide
 * whether a concurrent change from another device is disjoint (safe to
 * silently reapply) or overlapping (design.md 7.4, Phase 4).
 *
 * `create-element` and `reorder` name the array itself rather than a
 * specific index: an index computed against the pre-reload document (for
 * example "append at the current length") is meaningless once the array
 * may have changed size, and `diff.ts`'s array comparison already reports
 * a whole changed array as its own path, so comparing at that granularity
 * is what actually lines up.
 */
export function affectedPaths(operation: Operation): Path[] {
  switch (operation.kind) {
    case "create-entry":
      return [operation.path];
    case "create-element":
      return [operation.path.slice(0, -1)];
    case "rename":
      return [operation.path, operation.newPath];
    case "set-value":
      return [operation.path];
    case "reorder":
      return [operation.path];
    case "move":
      return [operation.path, operation.newPath];
    case "copy":
      return [operation.path, operation.newPath];
    case "delete":
      return [operation.path];
    case "restore":
      return [operation.path];
  }
}
