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
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";

export interface DocumentState {
  document: JsonObject;
  currentPath: Path;
  children: ChildEntry[];
  navigate: (path: Path) => void;
  createEntry: (key: string, value: JsonValue) => Result<JsonObject, TreeError>;
  createElement: (value: JsonValue) => Result<JsonObject, TreeError>;
  rename: (oldKey: string, newKey: string) => Result<JsonObject, TreeError>;
  setValue: (
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) => Result<JsonObject, TreeError>;
  reorder: (
    fromIndex: number,
    toIndex: number,
  ) => Result<JsonObject, TreeError>;
}

/**
 * Holds a document and the currently browsed path in local component state
 * and applies domain operations at that path. This is the Phase 1 "local
 * UI using fixture data" from impl.md; it has no knowledge of GitHub —
 * Phase 2 replaces the initial document and persistence of successful
 * operations with the repository adapter without changing this shape.
 */
export function useDocument(initialDocument: JsonObject): DocumentState {
  const [document, setDocument] = useState(initialDocument);
  const [currentPath, setCurrentPath] = useState<Path>([]);

  const children = useMemo(() => {
    const result = listChildren(document, currentPath);
    return result.ok ? result.value : [];
  }, [document, currentPath]);

  const navigate = useCallback((path: Path) => setCurrentPath(path), []);

  const applyIfOk = useCallback(
    (result: Result<JsonObject, TreeError>): Result<JsonObject, TreeError> => {
      if (result.ok) setDocument(result.value);
      return result;
    },
    [],
  );

  const createEntry = useCallback(
    (key: string, value: JsonValue) =>
      applyIfOk(createObjectEntry(document, currentPath, key, value)),
    [applyIfOk, document, currentPath],
  );

  const createElement = useCallback(
    (value: JsonValue) =>
      applyIfOk(createArrayElement(document, currentPath, value)),
    [applyIfOk, document, currentPath],
  );

  const rename = useCallback(
    (oldKey: string, newKey: string) =>
      applyIfOk(renameKey(document, currentPath, oldKey, newKey)),
    [applyIfOk, document, currentPath],
  );

  const setValue = useCallback(
    (path: Path, value: JsonValue, confirmReplace = false) =>
      applyIfOk(setValueAtPath(document, path, value, confirmReplace)),
    [applyIfOk, document],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) =>
      applyIfOk(reorderArrayElement(document, currentPath, fromIndex, toIndex)),
    [applyIfOk, document, currentPath],
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
