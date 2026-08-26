const PINNED_KEY = "notes/pinned";
const RECENT_KEY = "notes/recent";
const RECENT_LIMIT = 20;

function loadPointerSet(key: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(stored)) return new Set();
    return new Set(
      stored.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

export function loadPinned(): Set<string> {
  return loadPointerSet(PINNED_KEY);
}

export function loadRecent(): Set<string> {
  return loadPointerSet(RECENT_KEY);
}

export function savePinned(pointers: ReadonlySet<string>): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...pointers]));
}

export function saveRecent(pointers: ReadonlySet<string>): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify([...pointers]));
}

/** Device-local navigation metadata (docs/pinned.md 3); cleared on sign-out like TREE_EXPANSION_KEY. */
export function clearShortcuts(): void {
  localStorage.removeItem(PINNED_KEY);
  localStorage.removeItem(RECENT_KEY);
}

/**
 * Records a view: moves `pointer` to the most-recent end (a Set already
 * iterates in insertion order), re-adding it first if already present so it
 * moves rather than duplicates, then drops the oldest entries past the cap
 * (docs/pinned.md 4).
 */
export function recordVisit(
  pointers: ReadonlySet<string>,
  pointer: string,
): Set<string> {
  const next = new Set(pointers);
  next.delete(pointer);
  next.add(pointer);
  for (const oldest of next) {
    if (next.size <= RECENT_LIMIT) break;
    next.delete(oldest);
  }
  return next;
}

/** Most-recently-added first — the reverse of Set insertion order (docs/pinned.md 4). */
export function orderedMostRecentFirst(
  pointers: ReadonlySet<string>,
): string[] {
  return [...pointers].reverse();
}
