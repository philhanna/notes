import { encodePointer, resolvePointer } from "../domain/path.ts";
import { getAtPath, listChildren } from "../domain/tree.ts";
import type {
  JsonObject,
  JsonValue,
  Path,
  ValueKind,
} from "../domain/types.ts";
import { isContainer, kindOf } from "../domain/types.ts";

export interface VisibleTreeNode {
  path: Path;
  pointer: string;
  parentPath: Path | null;
  depth: number;
  label: string;
  value: JsonValue;
  kind: ValueKind;
  container: boolean;
  expanded: boolean;
  childCount: number;
  index: number | null;
  siblingCount: number;
}

export function pathsEqual(left: Path, right: Path): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

export function ancestorPaths(path: Path): Path[] {
  const ancestors: Path[] = [];
  for (let length = 0; length < path.length; length += 1) {
    ancestors.push(path.slice(0, length));
  }
  return ancestors;
}

export function expandAncestors(
  expandedPaths: ReadonlySet<string>,
  path: Path,
): Set<string> {
  const next = new Set(expandedPaths);
  for (const ancestor of ancestorPaths(path)) {
    next.add(encodePointer(ancestor));
  }
  return next;
}

export function deriveVisibleTree(
  document: JsonObject,
  expandedPaths: ReadonlySet<string>,
): VisibleTreeNode[] {
  const visible: VisibleTreeNode[] = [];

  function visit(
    value: JsonValue,
    path: Path,
    label: string,
    depth: number,
    index: number | null,
    siblingCount: number,
  ): void {
    const pointer = encodePointer(path);
    const container = isContainer(value);
    const children = container ? listChildren(document, path) : null;
    const childEntries = children?.ok ? children.value : [];
    const expanded = container && expandedPaths.has(pointer);
    visible.push({
      path,
      pointer,
      parentPath: path.length === 0 ? null : path.slice(0, -1),
      depth,
      label,
      value,
      kind: kindOf(value),
      container,
      expanded,
      childCount: childEntries.length,
      index,
      siblingCount,
    });

    if (!expanded) return;
    childEntries.forEach((entry) => {
      visit(
        entry.value,
        entry.path,
        entry.kind === "object-entry" ? entry.key : `[${entry.index}]`,
        depth + 1,
        entry.kind === "array-element" ? entry.index : null,
        childEntries.length,
      );
    });
  }

  visit(document, [], "Notes", 0, null, 1);
  return visible;
}

export function nearestExistingPath(document: JsonObject, path: Path): Path {
  for (let length = path.length; length >= 0; length -= 1) {
    const candidate = path.slice(0, length);
    if (getAtPath(document, candidate) !== undefined) return candidate;
  }
  return [];
}

export function validateExpandedPaths(
  document: JsonObject,
  expandedPaths: ReadonlySet<string>,
): Set<string> {
  const valid = new Set<string>();
  for (const pointer of expandedPaths) {
    const path = resolvePointer(document, pointer);
    const node = path === undefined ? undefined : getAtPath(document, path);
    if (isContainer(node)) valid.add(pointer);
  }
  return valid;
}

export function replacePathPrefix(
  path: Path,
  oldPrefix: Path,
  newPrefix: Path,
): Path {
  if (
    path.length < oldPrefix.length ||
    !oldPrefix.every((segment, index) => path[index] === segment)
  ) {
    return path;
  }
  return [...newPrefix, ...path.slice(oldPrefix.length)];
}

export function remapPointerSet(
  pointers: ReadonlySet<string>,
  oldPrefix: Path,
  newPrefix: Path,
): Set<string> {
  const oldPointer = encodePointer(oldPrefix);
  const newPointer = encodePointer(newPrefix);
  const next = new Set<string>();
  for (const pointer of pointers) {
    if (pointer === oldPointer || pointer.startsWith(`${oldPointer}/`)) {
      next.add(`${newPointer}${pointer.slice(oldPointer.length)}`);
    } else {
      next.add(pointer);
    }
  }
  return next;
}

export function removePointerSubtree(
  pointers: ReadonlySet<string>,
  path: Path,
): Set<string> {
  const prefix = encodePointer(path);
  return new Set(
    [...pointers].filter(
      (pointer) => pointer !== prefix && !pointer.startsWith(`${prefix}/`),
    ),
  );
}

export function remapArrayReorderPath(
  path: Path,
  parentPath: Path,
  fromIndex: number,
  toIndex: number,
): Path {
  if (
    path.length <= parentPath.length ||
    !parentPath.every((segment, index) => path[index] === segment)
  ) {
    return path;
  }
  const segment = path[parentPath.length];
  if (typeof segment !== "number") return path;
  let nextIndex = segment;
  if (segment === fromIndex) nextIndex = toIndex;
  else if (fromIndex < toIndex && segment > fromIndex && segment <= toIndex)
    nextIndex = segment - 1;
  else if (toIndex < fromIndex && segment >= toIndex && segment < fromIndex)
    nextIndex = segment + 1;
  if (nextIndex === segment) return path;
  const next = path.slice();
  next[parentPath.length] = nextIndex;
  return next;
}

export function remapArrayReorderPointers(
  pointers: ReadonlySet<string>,
  parentPath: Path,
  fromIndex: number,
  toIndex: number,
): Set<string> {
  const parentPointer = encodePointer(parentPath);
  const prefix = `${parentPointer}/`;
  return new Set(
    [...pointers].map((pointer) => {
      if (!pointer.startsWith(prefix)) return pointer;
      const remainder = pointer.slice(prefix.length);
      const slash = remainder.indexOf("/");
      const rawIndex = slash === -1 ? remainder : remainder.slice(0, slash);
      if (!/^(0|[1-9]\d*)$/.test(rawIndex)) return pointer;
      const index = Number(rawIndex);
      const mapped = remapArrayReorderPath(
        [...parentPath, index],
        parentPath,
        fromIndex,
        toIndex,
      )[parentPath.length];
      return `${prefix}${String(mapped)}${slash === -1 ? "" : remainder.slice(slash)}`;
    }),
  );
}
