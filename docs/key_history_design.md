# Last-modified tracking design

## 1. Purpose

Extend the notes app so that, for any leaf (scalar) value in the tree, the
user can see when it was last modified. This is a design addendum to
`docs/design.md`; it does not change anything in that document except by
adding the pieces described here.

## 2. Decisions

- **Leaves only.** Last-modified applies to scalar values, not to objects or
  arrays. Editing `/shell/bash/fc` does not change any displayed timestamp
  for `/shell/bash` or `/shell`. Containers have no timestamp of their own.
- **Relocation is not modification.** Rename, move, copy, and array reorder
  never change a leaf's last-modified timestamp. Only a change to the
  value itself (`set-value`, or the value's initial
  `create-entry`/`create-element`) does. This applies to copy as well as
  move/rename: a copy's destination leaves carry over their source leaves'
  timestamps unchanged, rather than being stamped as newly created.
- **Deletes are out of scope.** Consistent with `docs/design.md` section 10
  (no undo, no recovery UI), a deleted leaf's history is simply discarded.
  There is no "when was this deleted" or "what did it used to say" feature.

## 3. Representation

A second JSON file, `remember.meta.json`, sits alongside `remember.json` in
the same repository. It is a flat map from JSON Pointer path to an ISO 8601
UTC timestamp:

```json
{
  "/where-was-i": "2026-07-10T14:32:00Z",
  "/shell/bash/fc": "2026-06-02T09:11:45Z"
}
```

Only paths that currently resolve to a leaf appear in the map. There is no
entry for containers, and no entry survives past the deletion of its leaf
(orphaned entries are pruned on write — see section 5).

This mirrors `docs/design.md` section 5.4's stance that a JSON Pointer path,
not a separate ID, is the address of a value — the metadata file just reuses
that same addressing scheme instead of inventing a second one.

`remember.meta.json` is never part of JSON export (`docs/design.md` section
10: export contains only the active tree) and is not shown as a navigable
part of the tree. It is UI-support data, not user content.

## 4. Why a metadata file instead of deriving from git history

Two approaches were considered:

1. **Derive it from commit history.** Every commit message already names the
   path it touched (`commitMessage.ts`, e.g. `Set /where-was-i`). In
   principle the most recent commit whose message names a given path is that
   path's last-modified time.
2. **Maintain an explicit per-path map**, written alongside the document.

(1) was rejected. Those commit messages are documented in `docs/design.md`
section 9 as deliberately "value-free" text meant for a human reading `git
log` — not a machine-readable index — so parsing them as a source of truth
is fragile and would break silently if the message format ever changed for
a human-facing reason. It would also require walking commit history (paged,
unbounded — the repository's history grows forever, per section 10's
recovery model) to answer what should be an O(1) lookup.

(2) is the adopted approach. It is cheap here specifically because the hard
part — atomically committing more than one file in a single commit — is
already built and proven: `gitDataApi.ts` creates blobs/trees/commits
generically, and `githubRepository.ts` already drives `createTree` with an
`entries: TreeEntry[]` array (currently populated with one entry, the
document blob). Adding a second entry to that same array, in the same
`save()` call, is a small extension of an existing path, not new
architecture. Both blobs land in the same tree and the same commit, so they
can never drift out of sync with each other from a partial write.

## 5. Write path

`save()` in `githubRepository.ts` gains a second blob write. Given the same
`Operation` already passed in for the commit message (`repository.ts`), the
caller also supplies the updated metadata map, computed as follows before
`save()` is invoked:

| Operation | Effect on `remember.meta.json` |
| --- | --- |
| `create-entry` / `create-element` (leaf) | Add an entry for `path`, timestamped now. |
| `create-entry` / `create-element` (container) | No entry (containers are never tracked). |
| `set-value` | Update the entry for `path` to now. |
| `rename` | Relocate: entries under `path` move to `newPath`, timestamps unchanged. |
| `move` | Relocate: entries under `path` move to `newPath`, timestamps unchanged. |
| `copy` | Duplicate: entries under `path` are copied to `newPath` with the same timestamps; the originals under `path` are left as-is. |
| `reorder` | Relocate: entries whose positional path falls under the reordered array are renumbered in place, timestamps unchanged. |
| `delete` | Remove all entries under `path`. No further tracking. |

The relocate/renumber cases are not optional bookkeeping — because array
elements are addressed positionally, a `reorder`, `move`, or `delete`
anywhere in an ancestor array shifts every descendant path after it, whether
or not that descendant's value changed. `src/app/treeViewState.ts` already
solves exactly this problem for path-keyed view state (expanded rows,
selection): `replacePathPrefix`, `remapPointerSet`, `removePointerSubtree`,
and `remapArrayReorderPointers` exist today to keep those sets consistent
across every structural mutation. The metadata map should be threaded
through the same remapping calls at the same call sites, rather than given
its own parallel reconciliation logic — it is the same shape of problem
(a path-keyed side table riding alongside document mutations) with a
different payload (timestamp instead of membership).

## 6. Display

Not yet designed. Presumably a "modified N ago" annotation somewhere on a
leaf's row or its edit view; exact placement is a UI decision for later,
out of scope for this document.
