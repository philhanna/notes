# File-explorer tree view

## Status

This document proposes a change to the PWA's tree browser. It is a design
only; no implementation is included.

## Summary

Replace the current drill-down view with one continuous, vertically compact
tree resembling the Explorer in Visual Studio Code:

- the root is always shown;
- object and array nodes have disclosure controls and expand in place;
- expanded children are indented beneath their parent;
- collapsing a node hides all of its descendants without navigating away;
- expanding one branch does not hide other expanded branches;
- every visible node keeps its visible chain of parents above it in the tree;
- scalar values are previewed on the same line as their key or array index;
  and
- editing controls remain available, but do not give every row card-like
  spacing.

The tree should replace the current combination of a breadcrumb, level heading,
and cards containing only the current container's immediate children. Existing
domain operations, persistence, conflict handling, draft preservation, and
confirmation rules remain unchanged.

## Goals

- Show substantially more entries at once than the current card layout.
- Make the document's hierarchy apparent without repeatedly drilling in and
  backing out.
- Let the user compare and work in multiple expanded branches.
- Keep ancestors visible as part of the tree when a descendant is expanded.
- Work well in both an installed Android PWA and a desktop browser.
- Preserve all current create, edit, rename, reorder, move, copy, and delete
  capabilities.
- Provide complete keyboard and screen-reader interaction.

## Non-goals

- Recreating all of VS Code's appearance or behavior.
- Adding filesystem concepts that the JSON model does not have.
- Changing the stored JSON format or GitHub persistence.
- Adding stable IDs to document nodes.
- Adding drag-and-drop in this change.
- Caching note content in persistent browser storage.
- Implementing the design as part of this document.

## Current behavior and constraints

`TreeBrowser` currently renders breadcrumbs, a heading for `currentPath`, only
that container's immediate children, and a create form for that container.
Selecting a child container replaces the list with the child's contents.
`ChildRow` renders each child as a padded, bordered card with a separate action
menu. This is easy to read but consumes considerable vertical space and removes
the surrounding hierarchy during navigation.

`useDocument` exposes `currentPath`, its derived `children`, and mutations.
Several mutations implicitly use `currentPath` as the containing object or
array:

- creating an entry or array element;
- renaming an object key; and
- reordering an array element.

Paths contain object keys and array indexes and there are no stable node IDs.
Expansion state therefore has to be reconciled after rename, move, delete, and
array reorder operations.

The current design document requires a breadcrumb. If this proposal is
accepted, `docs/design.md` section 6.1 and the corresponding implementation
record should be updated when the feature is implemented.

## Proposed interaction model

### Tree structure

Render a single root tree item labelled `Notes`. The root is expanded initially
and cannot be removed. Objects and arrays are container nodes. Scalars are leaf
nodes.

A container row contains:

1. a disclosure control;
2. an object or array icon;
3. its key or array index;
4. an optional muted child count; and
5. a row actions button.

A scalar row contains:

1. a leaf or type icon;
2. its key or array index;
3. a compact separator; for example `:`;
4. a single-line value preview; and
5. a row actions button.

Children appear immediately after an expanded parent and are indented one level.
Collapsing a container removes all of its descendant rows from the visible
sequence but retains those descendants' expansion state during the current
session. Re-expanding the parent therefore restores the branch as it was.

Empty containers still have a disclosure control. Expanding one shows a small
indented `Empty` row and makes it possible to select the container and add its
first child. Keeping a consistent disclosure target avoids the control moving
when the first child is created.

### Expansion and selection are separate

Expansion controls which branches are visible. Selection controls which node is
the current target for contextual operations.

- Activating a disclosure control only expands or collapses the container.
- Activating the rest of a row selects it.
- Selecting a container makes it the target of the add-entry/add-element
  control.
- Selecting a scalar makes Edit its primary action.
- The selected row has a clear background and focus treatment. Selection must
  not be conveyed by color alone.

This separation prevents an attempt to select a node from unexpectedly hiding
its descendants.

### Compact presentation

The normal tree should not use cards, borders, rounded boxes, or vertical gaps
between rows. Use a shared tree surface with one horizontal row per node.

Proposed density:

- fine pointer/desktop: approximately 28–32 CSS pixels per closed row;
- coarse pointer/phone: approximately 44 CSS pixels per closed row, with a
  touch target large enough to select reliably with a finger;
- indentation: approximately 16 CSS pixels per nesting level;
- row padding: 4–6 CSS pixels vertically and 6–8 horizontally;
- icons and disclosure controls: approximately 16 CSS pixels; and
- no wrapping in the normal row.

Long keys and scalar previews use ellipsis. The full text is available through
the selected row's editor and may also be exposed with a tooltip. The key gets
space before the value preview is truncated. Multiline strings remain one line
in the tree, with line breaks represented or collapsed for preview.

Action buttons should appear on hover or keyboard focus on devices with a fine
pointer. On touch devices the actions button should remain visible. It must
remain keyboard reachable even when visually hidden.

### Example

```text
▾ Notes
  ▸ list                         [3]                         ⋯
  ▾ tips                         {1}                         ⋯
    ▾ bash                       {1}                         ⋯
        fc: "recent history"                                 ⋯
    hardinfo: "system info"                                  ⋯
```

The braces and brackets above illustrate object and array child counts; icons
may communicate the type more cleanly in the final visual treatment.

### Editing and row actions

Keep the existing actions and confirmation behavior. The compact row is the
view state; a row may temporarily grow when an editor or confirmation is open.

- `Edit` opens the existing value editor immediately below the selected row,
  indented to align with that row's content.
- `Rename` opens an inline key input in the row or directly below it.
- `Move to…` and `Copy to…` open a visual destination picker containing only
  valid object and array destinations. The picker uses the same expandable
  tree conventions as the main view, clearly marks the source, and disables
  invalid destinations such as the source itself or its descendants during a
  move. A collapsible advanced field may accept a JSON Pointer for power users
  and unusual deeply nested destinations, but it is not the primary interface.
- `Delete` retains the modal confirmation dialog.
- Array `Move up` and `Move down` remain in the action menu and remain
  accessible without drag-and-drop.

Only one row-level editor should be open at a time. Opening a different editor
should first require the current editor to be saved or explicitly cancelled so
unsaved draft text is never silently discarded.

The action menu should use an ellipsis label (`Actions for <name>`) rather than
a down-chevron, reserving chevrons for tree expansion.

### Creating children

The existing always-expanded create card would undermine the compact layout.
Replace it with an `Add child` action associated with the selected container.

Recommended behavior:

- show a small `+` action on the selected container row and include `Add child`
  in its action menu;
- open the existing create form inline as the final child of that container;
- label it `Add entry` for objects and `Add element` for arrays;
- expand the container automatically if necessary; and
- retain the existing path-keyed session draft behavior.

The form may be visually compact, but its fields and inferred-value feedback
should not be compressed enough to harm readability.

### Search integration

Selecting a search result should:

1. close the search view;
2. expand every ancestor of the matching node;
3. select the matching node, rather than only its containing level;
4. scroll it into view; and
5. move keyboard focus to it.

This requires search results to pass the result path to the tree, not only the
current `containerPath`. If a search result represents a container, that
container need not be automatically expanded; only its ancestors must be.

### Focus and keyboard behavior

Use the WAI-ARIA tree pattern with `role="tree"`, `role="treeitem"`,
`aria-expanded` on containers, and `role="group"` for child collections. Do not
model the tree as a nested set of unrelated buttons.

Support the conventional tree keyboard interactions:

- `Arrow Down` and `Arrow Up`: move focus through visible rows;
- `Arrow Right`: expand a collapsed container, or move to its first child when
  already expanded;
- `Arrow Left`: collapse an expanded container, or move to its parent;
- `Home` and `End`: move to the first or last visible row;
- `Enter` or `Space`: select the focused row;
- `*`: optionally expand sibling containers; and
- context-menu key or `Shift+F10`: optionally open row actions.

Use roving `tabIndex`: one tree item is in the page tab order, while arrow keys
move within the tree. Inline forms and action menus retain ordinary tab
behavior. When an inline form closes, focus returns to its row. After deleting
a node, focus moves to the next visible sibling, previous sibling, or parent,
in that order.

### Keeping parents visible

The meaning of "always has the parent nodes visible" is structural: opening a
descendant never replaces its ancestors or siblings with a new screen. Its
complete visible ancestor chain remains rendered above it.

For a node found by search or selected programmatically, expand its complete
ancestor chain before scrolling to it. Normal scrolling may still move ancestors
off screen. Ancestor rows will not be pinned or made sticky while scrolling.

## State and component design

### View state

Add tree-specific UI state above or inside `TreeBrowser`:

- `expandedPaths`: a set of encoded JSON Pointer strings;
- `selectedPath`: the selected node;
- `focusedPath`: the row participating in roving focus; and
- `editingPath` plus an editing mode, if row-local state is moved upward to
  enforce one open editor.

Remember `expandedPaths` across app reloads and sessions in per-device browser
storage. Paths contain note keys, so this stores navigation metadata but not
note values. Treat the stored data as an untrusted hint: after loading a
document, retain only paths that still resolve to containers. Clear it on sign
out along with other device-local app state.

Keep `selectedPath`, `focusedPath`, and editor state in memory only. Session
storage remains appropriate for the already-supported unsaved input drafts.

The root starts expanded and selected. Expansion should otherwise survive
switching temporarily to Search and back because `ReadyApp` currently unmounts
the tree view while search is shown; this means the expansion and selection
state should live in `ReadyApp` or the tree should remain mounted but hidden.
Lifting the small state into `ReadyApp` is simpler and avoids hidden interactive
content.

### Visible-node model

Derive a flat array of visible rows from `document` and `expandedPaths`. Each
row should include:

- path and encoded path;
- parent path;
- depth;
- key or array index label;
- value and value kind;
- child count;
- whether it is a container;
- whether it is expanded; and
- sibling metadata needed for array move controls.

A flat visible-node array is preferable to making each recursive component
independently discover keyboard neighbors. It gives arrow-key focus movement,
`Home`/`End`, search-result scrolling, and post-delete focus recovery one
authoritative row order. Rendering may still use nested semantic groups if
needed for ARIA.

The document's intended size is small, so deriving visible nodes on document or
expansion changes is sufficient. Virtual scrolling would complicate ARIA and
sticky ancestors and is unnecessary unless real document sizes demonstrate a
problem.

### Mutation API changes

The domain functions do not need to change. The UI-facing state should stop
making rename, reorder, and create depend implicitly on one global
`currentPath`. Prefer path-explicit methods:

- `createEntry(parentPath, key, value)`;
- `createElement(parentPath, value)`;
- `rename(parentPath, oldKey, newKey)`; and
- `reorder(parentPath, fromIndex, toIndex)`.

`setValue`, `move`, `copy`, and `deleteEntry` are already sufficiently
path-oriented. `currentPath`, `children`, and `navigate` can then be removed or
retained temporarily as compatibility state during implementation.

This change is important because multiple containers can be visible
simultaneously; an action must identify its target directly rather than depend
on whichever container was most recently "navigated into."

### Reconciling paths after mutations

Expansion and selection are keyed by paths, so successful structural mutations
must update view state:

- rename: replace the old path prefix with the new path prefix;
- move: replace the moved subtree's old prefix with its destination prefix;
- copy: leave the source state unchanged and start the new subtree collapsed;
- delete: remove expansion entries in the deleted subtree and select/focus a
  surviving sibling or parent;
- scalar/container replacement: discard descendant expansion entries when the
  new value has no corresponding descendants; and
- array reorder or an array insertion/removal: remap affected index prefixes.

Array remapping is the most error-prone case because array elements have no
stable identity. Put this logic in pure, independently tested path-remapping
helpers rather than scattering it through React components. If a mutation's
mapping cannot be determined safely, collapse the affected array and select it
instead of risking actions against the wrong element.

When conflict handling reloads a newer document, validate every expanded,
selected, focused, and editing path against the new document. Remove invalid
expansions and fall back to the nearest surviving ancestor. Never preserve an
editor against a different value merely because an array index still exists.

## Proposed component changes

- `TreeBrowser.tsx`: owns or receives tree view state, derives visible nodes,
  handles keyboard navigation, and coordinates inline editing.
- New `TreeRow.tsx`: renders one compact tree item and its disclosure, label,
  preview, type/count metadata, and actions trigger.
- `ChildRow.tsx`: retire after its editor/action behavior has been moved into
  `TreeRow` or smaller reusable controls.
- `Breadcrumbs.tsx`: remove from the normal tree view; the expanded tree is the
  ancestor navigation.
- `CreateEntryForm.tsx` and `ValueEditor.tsx`: reuse their validation, draft,
  and submit behavior with layout changes only.
- New destination-picker component: presents valid container destinations as a
  visual tree for move and copy, with an optional advanced JSON Pointer field.
- `SearchView.tsx`: return the exact selected result path.
- `useDocument.ts`: expose path-explicit mutation methods and stop deriving only
  one level's child list for the UI.
- `index.css`: replace card-list styling with tree surface, compact rows,
  indentation, selection, hover/focus actions, truncation, and coarse-pointer
  adaptations.

No third-party tree component is recommended. The data set and visual needs are
small, while correct integration with the existing path mutations, drafts, and
conflict behavior is application-specific.

## Responsive behavior

Use the same tree on phone and desktop rather than switching back to drill-down
navigation on small screens.

- Permit horizontal scrolling for exceptionally deep or long paths rather than
  wrapping rows and destroying vertical compactness.
- Keep the disclosure control, label, and actions trigger visible; truncate the
  scalar preview first.
- Increase row/action hit areas under `pointer: coarse` while retaining the
  compact one-line appearance.
- Scroll a newly focused row into the nearest visible position, not always to
  the top.
- Inline editors use the full available tree width below their row.
- The existing fixed bottom application actions must not obscure the last tree
  rows or an inline form.

## Visual and accessibility details

- Use the existing color palette and typography so this remains the same app,
  not a VS Code theme.
- Prefer simple CSS or inline SVG icons with `aria-hidden="true"`; accessible
  names must come from text and ARIA, not icon shape.
- Distinguish objects, arrays, and scalar types by icon or short type indicator.
- Maintain visible focus with at least the current focus-ring strength.
- Ensure selected, hovered, focused, and pending-save states are distinguishable.
- A saving row may disable conflicting actions but must continue to display its
  label and pending editor.
- Errors appear directly below their affected row or inline form and use
  `role="alert"` as today.
- Respect `prefers-reduced-motion`; disclosure does not require animation.
- Do not put the entire row inside a button when it also contains disclosure
  and actions buttons, which would create invalid nested controls.

## Testing and acceptance criteria

### Pure state tests

- Flattening returns only nodes whose complete ancestor chain is expanded.
- Object children retain their current deterministic sorted order.
- Array children retain document order.
- Collapse and re-expand restores descendant expansion within the session.
- Rename, move, delete, replacement, and array reorder correctly reconcile
  expansion, selection, and focus paths.
- Reload/conflict reconciliation falls back to a surviving ancestor.

### Component tests

- The root and parents remain rendered after expanding several levels.
- Multiple sibling branches can remain expanded together.
- Disclosure changes expansion without changing selection.
- Selecting a container targets creation to that exact path.
- Every existing row action still operates on the correct deeply nested path.
- Search expands ancestors, selects the exact result, scrolls it into view, and
  focuses it.
- Arrow-key, `Home`, and `End` behavior follows the visible row order.
- Focus recovery after collapse, delete, rename, and reorder is predictable.
- Only one editor is open; drafts survive save errors and safe refreshes.
- Empty objects and arrays can be expanded and populated.

### Browser and accessibility tests

- At a representative desktop width, at least twice as many ordinary closed
  rows fit vertically as in the current card view.
- At an Android phone width, rows remain one line, actions are reachable, and
  deep trees can be panned horizontally.
- Axe reports no automatically detectable violations for the populated tree and
  an open inline editor.
- The tree can be browsed and edited without a pointer.
- Screen-reader announcements include node label, type, level, selected state,
  and expanded/collapsed state where applicable.

### Regression tests

Existing behavior must remain covered for:

- create, edit, rename, move, copy, delete, and array reorder;
- destructive replacement and delete confirmation;
- case-insensitive key conflicts;
- persistence and concurrent-write errors;
- unsaved draft preservation;
- search; and
- export.

## Suggested implementation sequence

1. Make mutation methods path-explicit without changing the existing UI.
2. Add pure visible-node derivation and path-reconciliation helpers with tests.
3. Build the compact tree and disclosure/selection behavior using read-only
   rows.
4. Add keyboard and focus behavior.
5. Move existing row actions and editors into the new row layout.
6. Add inline creation for the selected container.
7. Integrate search-result reveal and focus.
8. Add responsive styling, accessibility checks, and regression tests.
9. Remove the old breadcrumb/card browser and update `docs/design.md` and
   `docs/impl.md`.

Each step should keep persistence and the stored document format unchanged.

## Open questions for the product owner

1. For a collapsed container row such as `▸ tips`, what should happen when the
   user taps or clicks the word `tips`, rather than the `▸` disclosure icon?

   - **Select only:** tapping `tips` highlights it and makes its actions
     available; tapping `▸` separately expands it.
   - **Select and expand:** tapping `tips` both highlights it and changes the
     row to `▾ tips`, immediately showing its children. Tapping an already
     selected, expanded label could either leave it open or collapse it.

   The design currently recommends **Select only**. It keeps selection and
   expansion predictable and avoids collapsing a branch when the user only
   wanted to select it for Add, Move, Copy, or Delete. The disclosure icon can
   have a finger-sized invisible hit area so it remains easy to use on a phone.

## Resolved product decisions

- Ancestors remain present in the expanded tree but are not pinned while the
  tree scrolls.
- Phone rows must remain easy to select with a finger. Coarse-pointer layouts
  use approximately 44-pixel row targets instead of pursuing desktop-level
  density.
- Remove the breadcrumb; the expanded tree provides ancestor context and
  navigation.
- Remember expanded paths between sessions on the device, validate them after
  loading, and clear them on sign out.
- Show scalar previews normally; no special hiding behavior is required for the
  single-user app.
- Allow only one inline editor at a time.
- Use a visual, expandable container tree as the primary move/copy destination
  picker. Retain JSON Pointer entry only as an optional advanced fallback.
