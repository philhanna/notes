import { encodePointer } from "../domain/path.ts";
import type { Operation } from "./repository.ts";

/** Generates a concise, value-free commit message from an operation (design.md 9). */
export function describeOperation(operation: Operation): string {
  switch (operation.kind) {
    case "create-entry":
    case "create-element":
      return `Create ${encodePointer(operation.path)}`;
    case "rename":
      return `Rename ${encodePointer(operation.path)} to ${encodePointer(operation.newPath)}`;
    case "set-value":
      return `Set ${encodePointer(operation.path)}`;
    case "reorder":
      return `Reorder ${encodePointer(operation.path)}`;
    case "move":
      return `Move ${encodePointer(operation.path)} to ${encodePointer(operation.newPath)}`;
    case "copy":
      return `Copy ${encodePointer(operation.path)} to ${encodePointer(operation.newPath)}`;
    case "delete":
      return `Delete ${encodePointer(operation.path)}`;
    case "recover":
      return `Restore ${encodePointer(operation.path)} from trash`;
    case "permanent-delete":
      return `Permanently delete ${encodePointer(operation.path)}`;
    case "empty-trash":
      return "Empty trash";
    case "restore":
      return `Restore ${encodePointer(operation.path)} to revision ${operation.revisionSha.slice(0, 7)}`;
  }
}
