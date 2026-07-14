import { useCallback, useMemo, useState } from "react";
import type { ChildEntry, TreeError } from "../domain/tree.ts";
import {
  createArrayElement,
  createObjectEntry,
  listChildren,
  renameKey,
  reorderArrayElement,
  setValueAtPath,
} from "../domain/tree.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import type { Operation, Repository } from "../persistence/repository.ts";
import type { PersistError } from "../persistence/types.ts";

/**
 * `TreeError` and `PersistError` both use a `kind` discriminant and their
 * value sets overlap (both have a `"not-found"` kind, for example), so a
 * mutation failure is tagged with its source rather than merged into one
 * flat union.
 */
export type MutationError =
  | { source: "domain"; error: TreeError }
  | { source: "persist"; error: PersistError };

export interface DocumentPersistence {
  repository: Repository;
  /** The `sha` `initialDocument` was loaded at. */
  initialSha: string;
}

export interface DocumentState {
  document: JsonObject;
  currentPath: Path;
  children: ChildEntry[];
  navigate: (path: Path) => void;
  createEntry: (
    key: string,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  createElement: (
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  rename: (
    oldKey: string,
    newKey: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  setValue: (
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) => Promise<Result<JsonObject, MutationError>>;
  reorder: (
    fromIndex: number,
    toIndex: number,
  ) => Promise<Result<JsonObject, MutationError>>;
}

/**
 * Holds a document and the currently browsed path in local component state
 * and applies domain operations at that path (Phase 1 of impl.md). When
 * `persistence` is supplied (Phase 2), each successful operation is also
 * committed through its `Repository` before local state is updated, so a
 * failed write leaves both the displayed document and the caller's pending
 * input untouched (design.md 9, 13). Without `persistence`, mutators still
 * return a Promise, resolved in the same microtask against local state only.
 */
export function useDocument(
  initialDocument: JsonObject,
  persistence?: DocumentPersistence,
): DocumentState {
  const [document, setDocument] = useState(initialDocument);
  const [currentPath, setCurrentPath] = useState<Path>([]);
  const [sha, setSha] = useState<string | null>(
    persistence?.initialSha ?? null,
  );

  const children = useMemo(() => {
    const result = listChildren(document, currentPath);
    return result.ok ? result.value : [];
  }, [document, currentPath]);

  const navigate = useCallback((path: Path) => setCurrentPath(path), []);

  const commit = useCallback(
    async (
      result: Result<JsonObject, TreeError>,
      operation: Operation,
    ): Promise<Result<JsonObject, MutationError>> => {
      if (!result.ok) return err({ source: "domain", error: result.error });
      if (!persistence) {
        setDocument(result.value);
        return ok(result.value);
      }
      if (sha === null) {
        throw new Error("useDocument: missing sha for a persisted document");
      }
      const saved = await persistence.repository.saveDocument(
        result.value,
        sha,
        operation,
      );
      if (!saved.ok) return err({ source: "persist", error: saved.error });
      setDocument(result.value);
      setSha(saved.value.sha);
      return ok(result.value);
    },
    [persistence, sha],
  );

  const createEntry = useCallback(
    (key: string, value: JsonValue) =>
      commit(createObjectEntry(document, currentPath, key, value), {
        kind: "create-entry",
        path: [...currentPath, key],
      }),
    [commit, document, currentPath],
  );

  const createElement = useCallback(
    (value: JsonValue) =>
      commit(createArrayElement(document, currentPath, value), {
        kind: "create-element",
        path: [...currentPath, children.length],
      }),
    [commit, document, currentPath, children.length],
  );

  const rename = useCallback(
    (oldKey: string, newKey: string) =>
      commit(renameKey(document, currentPath, oldKey, newKey), {
        kind: "rename",
        path: [...currentPath, oldKey],
        newPath: [...currentPath, newKey],
      }),
    [commit, document, currentPath],
  );

  const setValue = useCallback(
    (path: Path, value: JsonValue, confirmReplace = false) =>
      commit(setValueAtPath(document, path, value, confirmReplace), {
        kind: "set-value",
        path,
      }),
    [commit, document],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) =>
      commit(reorderArrayElement(document, currentPath, fromIndex, toIndex), {
        kind: "reorder",
        path: currentPath,
      }),
    [commit, document, currentPath],
  );

  return {
    document,
    currentPath,
    children,
    navigate,
    createEntry,
    createElement,
    rename,
    setValue,
    reorder,
  };
}
