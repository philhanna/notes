import { useState } from "react";
import { getAtPath } from "../domain/tree.ts";
import type { JsonValue, Path } from "../domain/types.ts";
import { isContainer, isJsonArray, isJsonObject } from "../domain/types.ts";

interface JsonTreeViewProps {
  rootLabel: string;
  value: JsonValue | undefined;
  emptyLabel: string;
}

/**
 * Renders a JSON value as a drillable tree rather than a JSON.stringify
 * blob. `selectedPath` tracks the currently selected node, starting at the
 * root; opening a container child navigates to it, and the breadcrumb
 * navigates back out. Used by HistoryPanel to preview revision values.
 */
export function JsonTreeView({
  rootLabel,
  value,
  emptyLabel,
}: JsonTreeViewProps) {
  const [selectedPath, setSelectedPath] = useState<Path>([]);

  if (value === undefined) {
    return <p className="json-tree-view__empty">{emptyLabel}</p>;
  }

  const node = getAtPath(value, selectedPath);
  const segments = [
    { label: rootLabel, target: [] as Path },
    ...selectedPath.map((segment, index) => ({
      label: String(segment),
      target: selectedPath.slice(0, index + 1),
    })),
  ];

  return (
    <div className="json-tree-view">
      <nav aria-label={`${rootLabel} path`} className="breadcrumbs">
        <ol>
          {segments.map((segment, index) => {
            const isCurrent = index === segments.length - 1;
            return (
              <li key={index}>
                {isCurrent ? (
                  <span aria-current="location">{segment.label}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedPath(segment.target)}
                  >
                    {segment.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {node === undefined ? (
        <p className="json-tree-view__empty">{emptyLabel}</p>
      ) : isContainer(node) ? (
        <JsonTreeChildren
          node={node}
          onOpen={(key) => setSelectedPath([...selectedPath, key])}
        />
      ) : (
        <code className="json-tree-view__value">{JSON.stringify(node)}</code>
      )}
    </div>
  );
}

function JsonTreeChildren({
  node,
  onOpen,
}: {
  node: JsonValue;
  onOpen: (key: string | number) => void;
}) {
  let entries: { key: string | number; value: JsonValue }[];
  if (isJsonArray(node)) {
    entries = node.map((entryValue, index) => ({
      key: index,
      value: entryValue,
    }));
  } else {
    const object = node as Record<string, JsonValue>;
    const keys = Object.keys(object).sort();
    entries = keys.map((key) => ({ key, value: object[key]! }));
  }

  if (entries.length === 0) {
    return (
      <p className="json-tree-view__empty">
        Empty {isJsonArray(node) ? "array" : "object"}.
      </p>
    );
  }

  return (
    <ul className="child-list json-tree-view__children">
      {entries.map((entry) => {
        const label =
          typeof entry.key === "number" ? `[${entry.key}]` : entry.key;
        const container = isJsonObject(entry.value) || isJsonArray(entry.value);
        return (
          <li key={entry.key} className="child-row">
            <div className="child-row__main">
              {container ? (
                <button
                  type="button"
                  className="child-row__open"
                  onClick={() => onOpen(entry.key)}
                >
                  {label}
                </button>
              ) : (
                <>
                  <span className="child-row__label">{label}</span>
                  <code className="child-row__preview">
                    {JSON.stringify(entry.value)}
                  </code>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
