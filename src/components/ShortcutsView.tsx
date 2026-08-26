import { orderedMostRecentFirst } from "../app/shortcutsStorage.ts";
import { describeShortcut } from "../app/treeViewState.ts";
import type { ShortcutEntry } from "../app/treeViewState.ts";
import type { JsonObject, Path } from "../domain/types.ts";

interface ShortcutsViewProps {
  document: JsonObject;
  pinnedPaths: Set<string>;
  recentPaths: Set<string>;
  onSelectPath: (path: Path) => void;
  onUnpin: (pointer: string) => void;
  onClose: () => void;
}

function resolveShortcuts(
  document: JsonObject,
  pointers: Set<string>,
): ShortcutEntry[] {
  return orderedMostRecentFirst(pointers)
    .map((pointer) => describeShortcut(document, pointer))
    .filter((entry): entry is ShortcutEntry => entry !== null);
}

/**
 * Pinned and recently viewed shortcut lists (docs/pinned.md 4), shown as a
 * third full-screen view alongside search, most-recent first. Both lists
 * are device-local navigation metadata, not tree content — see
 * docs/pinned.md 3 for why.
 */
export function ShortcutsView({
  document,
  pinnedPaths,
  recentPaths,
  onSelectPath,
  onUnpin,
  onClose,
}: ShortcutsViewProps) {
  const pinned = resolveShortcuts(document, pinnedPaths);
  const recent = resolveShortcuts(document, recentPaths);

  function handleSelect(entry: ShortcutEntry) {
    onSelectPath(entry.path);
    onClose();
  }

  return (
    <div className="search-view">
      <div className="search-view__header">
        <h2>Pinned &amp; recent</h2>
        <button type="button" onClick={onClose}>
          Back to notes
        </button>
      </div>

      <section className="shortcuts-view__section">
        <h3>Pinned</h3>
        {pinned.length === 0 ? (
          <p className="shortcuts-view__empty">
            Pin an entry from its actions menu to see it here.
          </p>
        ) : (
          <ul className="search-results">
            {pinned.map((entry) => (
              <li key={entry.pointer} className="shortcuts-view__row">
                <button
                  type="button"
                  className="search-results__item"
                  onClick={() => handleSelect(entry)}
                >
                  <span className="search-results__label">{entry.label}</span>
                  <span className="search-results__breadcrumb">
                    {entry.breadcrumb}
                  </span>
                </button>
                <button
                  type="button"
                  className="shortcuts-view__unpin"
                  aria-label={`Unpin ${entry.label}`}
                  onClick={() => onUnpin(entry.pointer)}
                >
                  Unpin
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="shortcuts-view__section">
        <h3>Recently viewed</h3>
        {recent.length === 0 ? (
          <p className="shortcuts-view__empty">Entries you open appear here.</p>
        ) : (
          <ul className="search-results">
            {recent.map((entry) => (
              <li key={entry.pointer}>
                <button
                  type="button"
                  className="search-results__item"
                  onClick={() => handleSelect(entry)}
                >
                  <span className="search-results__label">{entry.label}</span>
                  <span className="search-results__breadcrumb">
                    {entry.breadcrumb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
