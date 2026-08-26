# Pinned and recently viewed entries — design

## 1. Purpose

The tree can grow deep (design.md §2), and the entries a user checks most —
a frequently looked-up ID, a standing reminder — are not necessarily near
the root. This feature adds two device-local shortcut lists so those
entries are reachable without walking the tree each time:

- **Pinned** — entries the user explicitly marks for quick access.
- **Recently viewed** — the last few entries the user opened, tracked
  automatically.

## 2. Goals and scope

In scope:

- pin and unpin any object, array, or scalar entry from its row;
- an automatically maintained, capped list of recently viewed entries;
- a dedicated view listing both, each entry jumping to its place in the
  tree (reusing the reveal behavior search already provides);
- correct behavior across rename, move, copy, delete, and array reorder.

Out of scope, consistent with existing design decisions:

- **syncing pins across devices** — see §3 for why this stays device-local;
- manually reordering pinned entries (list order is pin time, most recent
  first — the same simplicity design.md §7.2 applies to other lists);
- pinning a search result directly from `SearchView` (pin remains a row
  action, exactly like rename/move/copy/delete);
- any Git commit, history, or recovery semantics — like expanded-tree state
  (design.md §6.1), this is navigation metadata, not tree content.

## 3. Data model and storage location

**Decision: both lists are device-local, stored in `localStorage`, not
written into `remember.json`.**

This mirrors `expandedPaths` (design.md §6.1, `TREE_EXPANSION_KEY`), and
follows directly from constraints the design already commits to:

- §5.4: "the application does not split levels or top-level objects into
  separate files" — the only alternative location for repo-synced pin data
  is a reserved key inside the user's own document, which would then show
  up in search results (§11 indexes the whole document) and in JSON export
  (§10) unless specially filtered everywhere. That special-casing is worse
  than not syncing.
- §9: every write is one meaningful commit ("Set /where-was-i", "Delete
  /with-rating"). Pinning is not a content change; giving it a commit
  ("Pin /shell/bash/fc") would clutter history with navigation noise, the
  same reasoning that already keeps expansion state out of Git.
- §12: "No second automated storage, history, or restoration system is
  used" — repo-synced pins would need conflict handling (§7.4) for a
  purely cosmetic feature, which is the single-storage-system constraint
  the design already declined to take on.

The tradeoff is explicit: pins and recents do **not** follow the user to
their other device, the same as which branches are currently expanded.
This is recorded as an open decision in §8, not a settled non-goal — see
that section for what would change it.

Storage keys, following the existing `notes/…` convention
(`repoConfig.ts`, `TREE_EXPANSION_KEY`):

| Key              | Contents                                              |
| ---------------- | ------------------------------------------------------ |
| `notes/pinned`   | JSON array of JSON Pointer strings, most-recently-pinned first |
| `notes/recent`   | JSON array of JSON Pointer strings, most-recently-viewed first |

Both are cleared on sign-out, exactly like `TREE_EXPANSION_KEY`, so a
previous account's device-local metadata never leaks into a fresh sign-in
on a shared device.

## 4. User interface

A third action-bar button, alongside Search (design.md §6.1), opens a
**Shortcuts** view — the same full-screen swap `App.tsx` already does for
`view: "tree" | "search"`, extended to `"tree" | "search" | "shortcuts"`.
This reuses the existing pattern rather than adding a permanently visible
panel to the tree browser.

The Shortcuts view has two sections, each rendered like `SearchView`'s
result list (breadcrumb + label, design.md §11):

- **Pinned** — empty state explains how to pin something. Each row has an
  unpin action.
- **Recently viewed** — empty until the user has opened something; no
  manual removal, since the entry drops off naturally as more recent ones
  push it past the cap.

Selecting either kind of entry closes the Shortcuts view and reveals the
target exactly as a search result does today: expand its ancestor chain,
select it, scroll it into view, move keyboard focus to it
(`revealPath` / `onRevealHandled` in `App.tsx`).

**Pinning** is a new per-row action next to rename/move/copy/delete
(design.md §6.1, §7), a star toggle. It requires no confirmation — unlike
delete, it is fully and instantly reversible.

**Recently viewed** is populated automatically: opening an entry's detail
panel (the read-only Markdown view or the direct `Edit` action described
in design.md §6.1) records it. Passing through a container while
expanding/collapsing the tree does not count — only the entry the user
actually stopped to look at or edit. Re-opening an entry already in the
list moves it to the front rather than duplicating it. The list is capped
at 20 entries; the oldest is dropped once the cap is exceeded.

## 5. Path lifecycle

Pinned and recent pointers are JSON Pointers, exactly like
`expandedPaths`, so they need the same reconciliation `TreeBrowser.tsx`
already performs on every structural mutation
(`src/app/treeViewState.ts`). No new remapping logic is needed — the
existing functions are reused directly:

| Operation      | Applied to both `notes/pinned` and `notes/recent` |
| -------------- | -------------------------------------------------- |
| Rename / move  | `remapPointerSet(pointers, oldPath, newPath)`       |
| Delete         | `removePointerSubtree(pointers, path)`              |
| Array reorder  | `remapArrayReorderPointers(pointers, parentPath, fromIndex, toIndex)` |
| Copy           | no change — the source path a pin/recent entry points at still exists; the new destination is never auto-pinned |
| Document load  | drop any pointer that no longer resolves, per below |

`validateExpandedPaths` cannot be reused as-is: it only keeps pointers
that resolve to a **container** (`isContainer(node)`), because expansion
only ever applies to containers. Pinned and recent pointers must resolve
to *any* existing node, container or scalar. This needs a small sibling
function in `treeViewState.ts` — e.g. `validatePointerSet(document,
pointers)` — that drops a pointer only when `resolvePointer` /
`getAtPath` fails to find it at all, and `validateExpandedPaths` becomes a
thin wrapper that additionally requires `isContainer`. Both `notes/pinned`
and `notes/recent` are re-validated on every load and after every conflict
retry reload (design.md §7.4), the same points where `expandedPaths` is
already reconciled.

## 6. Testing

Following the pattern already established for `treeViewState.ts` and
`TreeBrowser.tsx`:

- unit tests for `validatePointerSet` (resolvable scalar/container kept,
  missing pointer dropped) alongside the existing remap/removal tests;
- unit tests for the recent-list cap and de-duplication-by-moving-to-front
  behavior;
- component tests (mirroring `SearchView.test.tsx`) for the Shortcuts view
  rendering, empty states, and reveal-on-select;
- a `TreeBrowser` test extending the existing rename/move/delete/reorder
  cases to assert pinned/recent pointers are remapped or dropped the same
  way `expandedPaths` already is.

## 7. Open questions

- **Should pinned entries sync via the repository instead of staying
  device-local?** §3 lays out why the current design avoids it, but if
  cross-device pins turn out to matter in practice, the least-disruptive
  path would likely be a dedicated file (e.g. `remember.pinned.json`)
  written with its own conditional commit, kept separate from
  `remember.json` rather than a reserved key inside it — still a
  deliberate exception to §5.4's one-file rule, not a default to take
  lightly.
- **Does "recently viewed" need its own cap tuning?** 20 is a starting
  guess, not a measured value; revisit once real usage on a phone screen
  shows whether that is too long to scan or too short to be useful.
