import { useCallback, useMemo, useState } from "react";
import type { ChildEntry, TreeError } from "../domain/tree.ts";
import {
  copy as copyInTree,
  createArrayElement,
  createObjectEntry,
  getAtPath,
  listChildren,
  move as moveInTree,
  renameKey,
  reorderArrayElement,
  setValueAtPath,
} from "../domain/tree.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import { isJsonArray, isJsonObject } from "../domain/types.ts";
import type { TrashDocument, TrashRecord } from "../domain/trash.ts";
import {
  deleteToTrash,
  EMPTY_TRASH,
  emptyTrash as emptyTrashDomain,
  permanentlyDelete,
  recoverFromTrash,
} from "../domain/trash.ts";
import { decodePointerSegments } from "../domain/path.ts";
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
  /** The trash `initialDocument` was loaded alongside. Defaults to empty for a brand-new document. */
  initialTrash?: TrashDocument;
}

export interface DocumentState {
  document: JsonObject;
  trash: TrashDocument;
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
  move: (
    fromPath: Path,
    toParentPath: Path,
    newKey?: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  copy: (
    fromPath: Path,
    toParentPath: Path,
    newKey?: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  deleteEntry: (path: Path) => Promise<Result<JsonObject, MutationError>>;
  recover: (
    trashId: string,
    destination?: { parentPath: Path; key?: string },
  ) => Promise<Result<JsonObject, MutationError>>;
  permanentlyDeleteTrash: (
    trashId: string,
  ) => Promise<Result<TrashDocument, MutationError>>;
  emptyTrash: () => Promise<Result<TrashDocument, MutationError>>;
}

/** Where `move`/`copy` placed a value, for the commit message only (design.md 9's "value-free"). */
function describeInsertedPath(
  document: JsonObject,
  toParentPath: Path,
  key: string | undefined,
  fromPath: Path,
): Path {
  const parent = getAtPath(document, toParentPath);
  if (isJsonObject(parent)) {
    const lastSourceSegment = fromPath[fromPath.length - 1];
    const resolvedKey =
      key ?? (typeof lastSourceSegment === "string" ? lastSourceSegment : "");
    return [...toParentPath, resolvedKey];
  }
  if (isJsonArray(parent)) return [...toParentPath, parent.length];
  return toParentPath;
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
  const [trash, setTrash] = useState<TrashDocument>(
    persistence?.initialTrash ?? EMPTY_TRASH,
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
      const saved = await persistence.repository.save(
        { document: result.value, trash },
        sha,
        operation,
      );
      if (!saved.ok) return err({ source: "persist", error: saved.error });
      setDocument(result.value);
      setSha(saved.value.sha);
      return ok(result.value);
    },
    [persistence, sha, trash],
  );

  /** Like `commit`, but for an operation that changes both the active tree and trash together (design.md 7.3). */
  const commitDocumentAndTrash = useCallback(
    async (
      result: Result<{ document: JsonObject; trash: TrashDocument }, TreeError>,
      operation: Operation,
    ): Promise<Result<JsonObject, MutationError>> => {
      if (!result.ok) return err({ source: "domain", error: result.error });
      if (!persistence) {
        setDocument(result.value.document);
        setTrash(result.value.trash);
        return ok(result.value.document);
      }
      if (sha === null) {
        throw new Error("useDocument: missing sha for a persisted document");
      }
      const saved = await persistence.repository.save(result.value, sha, operation);
      if (!saved.ok) return err({ source: "persist", error: saved.error });
      setDocument(result.value.document);
      setTrash(result.value.trash);
      setSha(saved.value.sha);
      return ok(result.value.document);
    },
    [persistence, sha],
  );

  /** Like `commit`, but for a trash-only operation (permanent delete, empty trash) that leaves the active tree unchanged. */
  const commitTrash = useCallback(
    async (
      result: Result<TrashDocument, TreeError>,
      operation: Operation,
    ): Promise<Result<TrashDocument, MutationError>> => {
      if (!result.ok) return err({ source: "domain", error: result.error });
      if (!persistence) {
        setTrash(result.value);
        return ok(result.value);
      }
      if (sha === null) {
        throw new Error("useDocument: missing sha for a persisted document");
      }
      const saved = await persistence.repository.save(
        { document, trash: result.value },
        sha,
        operation,
      );
      if (!saved.ok) return err({ source: "persist", error: saved.error });
      setTrash(result.value);
      setSha(saved.value.sha);
      return ok(result.value);
    },
    [persistence, sha, document],
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

  const move = useCallback(
    (fromPath: Path, toParentPath: Path, newKey?: string) =>
      commit(moveInTree(document, fromPath, toParentPath, newKey), {
        kind: "move",
        path: fromPath,
        newPath: describeInsertedPath(document, toParentPath, newKey, fromPath),
      }),
    [commit, document],
  );

  const copy = useCallback(
    (fromPath: Path, toParentPath: Path, newKey?: string) =>
      commit(copyInTree(document, fromPath, toParentPath, newKey), {
        kind: "copy",
        path: fromPath,
        newPath: describeInsertedPath(document, toParentPath, newKey, fromPath),
      }),
    [commit, document],
  );

  const deleteEntry = useCallback(
    (path: Path) =>
      commitDocumentAndTrash(
        deleteToTrash(document, trash, path, {
          id: crypto.randomUUID(),
          deletedAt: new Date().toISOString(),
        }),
        { kind: "delete", path },
      ),
    [commitDocumentAndTrash, document, trash],
  );

  const recover = useCallback(
    (trashId: string, destination?: { parentPath: Path; key?: string }) => {
      const record: TrashRecord | undefined = trash.records.find(
        (candidate) => candidate.id === trashId,
      );
      const path = record ? decodePointerSegments(record.originalPath) : [];
      return commitDocumentAndTrash(
        recoverFromTrash(document, trash, trashId, destination),
        { kind: "recover", path },
      );
    },
    [commitDocumentAndTrash, document, trash],
  );

  const permanentlyDeleteTrash = useCallback(
    (trashId: string) => {
      const record = trash.records.find((candidate) => candidate.id === trashId);
      const path = record ? decodePointerSegments(record.originalPath) : [];
      return commitTrash(permanentlyDelete(trash, trashId), {
        kind: "permanent-delete",
        path,
      });
    },
    [commitTrash, trash],
  );

  const emptyTrash = useCallback(
    () => commitTrash(ok(emptyTrashDomain(trash)), { kind: "empty-trash" }),
    [commitTrash, trash],
  );

  return {
    document,
    trash,
    currentPath,
    children,
    navigate,
    createEntry,
    createElement,
    rename,
    setValue,
    move,
    copy,
    deleteEntry,
    recover,
    permanentlyDeleteTrash,
    emptyTrash,
    reorder,
  };
}
