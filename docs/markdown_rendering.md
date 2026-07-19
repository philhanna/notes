# Rendering string values as Markdown

## Status

Implemented. Resolved open questions: `marked` as the CommonMark library;
blanket treatment (every string is Markdown); selecting a string opens the
rendered view by default; the view panel supports plain CommonMark only (no
GFM tables, task lists, strikethrough, or autolinks). See `src/domain/markdown.ts`,
`src/components/TreeRow.tsx`, and `src/components/TreeBrowser.tsx`.

## Summary

Currently every scalar's preview in the tree is `JSON.stringify(node.value)`:
a string shows as its raw, quoted, JSON-escaped text (for example
`"recent history"`), and editing happens through the plain-text
`ValueEditor`. This proposal renders **string** scalar values as Markdown
wherever their content is displayed, while leaving storage, editing input,
and non-string scalars unchanged.

## Goals

- Let prose-like note values (headings, emphasis, lists, links, code) display
  as formatted text instead of raw escaped JSON.
- Keep the compact, single-line, non-wrapping row contract from
  `docs/tree_view.md` intact for the closed tree.
- Keep the stored document format, `setValueAtPath`, and the plain-text
  `ValueEditor` round-trip completely unchanged — this is a display-only
  feature.
- Render untrusted Markdown safely; a note's content can in principle be
  edited outside the app in the GitHub-backed document (`docs/design.md`).

## Non-goals

- No WYSIWYG Markdown editor. Raw source editing stays exactly as
  `ValueEditor` works today.
- No new stored metadata marking "this string is Markdown"; every string is
  treated the same way (see Open Questions for the alternative).
- No change to how numbers, booleans, or null render, and no change to how
  object keys render.
- No live/clickable links or embedded images inside the compact row preview.
- No change to search matching, which continues to operate on raw string
  content.

## Which values are affected

Every node whose `kind` is `"string"` (`src/domain/types.ts`'s `ValueKind`)
is rendered as Markdown wherever its value is shown. `number`, `boolean`,
and `null` nodes keep today's `JSON.stringify` preview untouched. This is a
blanket rule rather than a per-entry opt-in — see Open Questions.

## Two rendering surfaces

Markdown has both inline constructs (bold, italic, code, links) and block
constructs (headings, lists, code blocks, blockquotes, tables). The tree's
closed row is a fixed one-line, non-wrapping surface; full Markdown does not
fit there. This proposal uses two different renderings of the same source
string, both produced by one shared module (see below) so there is a single
place that owns parsing and sanitizing policy.

### 1. Row preview — inline only, flattened to one line

Replaces the `<code className="tree-row__preview">{JSON.stringify(node.value)}</code>`
branch in `TreeRow.tsx` for string nodes only.

- Parse the string and keep only what can survive on one line: bold,
  italic, strikethrough, and inline code. Link *text* is shown, styled, but
  not as a clickable anchor (see Interactivity, below).
- Flatten everything block-level rather than trying to special-case it:
  - headings render as bold text, with the `#` markers stripped;
  - paragraph and line breaks collapse to a single space, consistent with
    tree_view.md's existing "line breaks represented or collapsed for
    preview" rule for multiline strings;
  - list items are flattened and joined with a middle-dot separator
    (`item one · item two`);
  - blockquote markers are stripped, leaving the quoted text inline;
  - fenced/indented code blocks show as inline `code` styling of their
    first line, with a trailing ellipsis if more follows;
  - images are replaced by their alt text, never fetched or embedded in the
    row;
  - anything else uncommon in a short scalar (tables, rules, footnotes)
    degrades to plain text rather than getting bespoke handling.
- The row keeps its `title` attribute for the native tooltip, but its value
  becomes the fully stripped plain-text form of the string rather than the
  JSON-quoted form.
- CSS truncation (`text-overflow: ellipsis`, no wrapping) is unchanged; it
  now truncates rendered inline markup instead of raw text.

### 2. Rendered view panel — full fidelity, read-only

A new panel, structurally the same kind of element as the existing
`edit-value`/`rename`/`relocate`/`create` panels that already appear below a
row in `tree-row__panel`.

- Full CommonMark rendering: headings, paragraphs, lists, blockquotes,
  fenced code blocks, horizontal rules, and (if GFM is enabled) tables.
- Links render as real anchors — `target="_blank" rel="noopener noreferrer"`
  — but only for `http:`, `https:`, and `mailto:` targets. Any other scheme
  (`javascript:`, `data:`, `vbscript:`, bare `#`, etc.) renders as inert
  text instead of an anchor.
- Images render with `max-width: 100%` so a large image cannot break the
  tree's layout; a missing/broken `src` falls back to the `<img>` element's
  native alt-text behavior.
- Because this panel occupies the same `tree-row__panel` slot as the other
  row editors, it should participate in the existing "only one panel open
  at a time" rule (tree_view.md, "Editing and row actions") by becoming
  another `RowEditor` mode rather than a parallel, independently-tracked
  piece of state.
- The rendered markup is ordinary semantic HTML (`h1`–`h6`, `ul`/`ol`/`li`,
  `p`, `a`, `code`, …), so it needs no bespoke ARIA beyond what the browser
  already provides for those elements.

## Selection and interaction semantics

Today: "Selecting a scalar makes Edit its primary action" (`docs/design.md`
6.1; `docs/tree_view.md`). This proposal narrows that specifically for
strings: selecting a string row opens the read-only rendered view panel,
and an explicit `Edit` action (already present in the row's actions menu)
switches to the current raw-text `ValueEditor`. Selecting a number, boolean,
or null row is unchanged — there is nothing to render, so `Edit` remains the
direct primary action for those kinds.

This is a genuine behavior change from the current interaction model and is
listed as an open product decision below rather than assumed.

## Library and security

No Markdown dependency exists in `package.json` yet. Recommend adding one
small, actively maintained CommonMark (optionally +GFM) parser — `marked`
or `markdown-it` are the obvious candidates — configured so that:

- raw HTML present in the source string is treated as literal text, never
  executed; do not enable an "HTML passthrough" parser option;
- link and image URLs are checked against an allowlist (`http:`, `https:`,
  `mailto:`) at render time, independent of the library's own defaults;
- the produced HTML is still run through a sanitizer (for example
  DOMPurify) before being set via `dangerouslySetInnerHTML`, as defense in
  depth beyond disabling raw HTML at the parser.

Centralize all of this in one new pure module, e.g. `src/domain/markdown.ts`,
exporting something like:

- `renderInline(text): { html: string; plainText: string }` for the row
  preview and its `title`/aria text, and
- `renderBlock(text): string` for the view panel.

`TreeRow.tsx` should not embed parsing or sanitizing policy directly; it
only calls this module. `plainText` is reused for the row's tooltip and can
also feed the existing aria-label `description` string, so screen readers
hear meaningful content instead of literal `#`/`*`/`` ` `` syntax.

Parsing cost should be memoized per node value (`useMemo` keyed by the
string), consistent with tree_view.md's assumption that the document is
small enough to re-derive fully on change without virtualization.

## Search

`SearchView.tsx` continues to match against the raw string value, not
rendered HTML, so Markdown syntax characters remain searchable exactly as
typed. This proposal only changes how a matched scalar's value looks once
the tree scrolls to and displays it, not how matching works.

## Component changes

- New `src/domain/markdown.ts`: parsing, sanitizing, inline-flattening, and
  plain-text extraction as described above; pure functions, unit-testable
  without React.
- `TreeRow.tsx`: string-kind nodes use the new inline-rendered span instead
  of `JSON.stringify`; number/boolean/null nodes are unchanged. Add a
  `"view"` mode to the `RowEditor` union (or equivalent), rendered as a new
  `tree-row__panel` branch, with its own `Edit` control that swaps to
  `"edit-value"` in place.
- `index.css`: styling for headings/lists/code/tables inside the view
  panel, inline emphasis styling for the row preview, and a `max-width`
  rule for panel images.
- `treeViewState.ts` and `useDocument.ts`: unaffected. This is a rendering
  change only; no path, mutation, or persistence logic changes.

## Testing and acceptance criteria

- Pure tests for `markdown.ts`: CommonMark constructs render as expected
  HTML; disallowed link/image URL schemes are neutralized; a
  `<script>`/event-handler injection attempt embedded in a string value
  produces inert output; inline-flattening collapses headings, lists, code
  blocks, and line breaks onto one line while preserving emphasis;
  plain-text extraction strips all markup.
- Component tests: selecting a string row opens the read-only rendered
  panel rather than the editable textarea; `Edit` from that panel opens
  `ValueEditor` pre-filled with the raw, unrendered source; only one panel
  is open at a time, consistent with the existing rule; number/boolean/null
  rows are pixel-for-pixel unchanged from current behavior.
- Regression: the `ValueEditor` raw-text round trip (typed text → inferred
  JSON value) is unaffected; search still matches raw string content; row
  truncation/ellipsis still behaves correctly with rendered inline markup
  in place of plain text.

## Open questions for the product owner

1. Should every string be treated as Markdown, or only ones that look like
   prose (contain a newline, or recognizable Markdown syntax), leaving
   short single-token strings such as IDs or single words as plain text?
   Blanket treatment is simpler and is what this design assumes, but a
   string like `[TODO]` or `a_b_c` will pick up unintended
   link-bracket/emphasis styling.
2. Should selecting a string row default to the rendered view (this
   design's recommendation), or keep today's "select → edit" primary
   action, with the rendered view reachable as a secondary toggle instead?
3. Library choice: `marked`, `markdown-it`, or a minimal hand-rolled
   inline-only parser that avoids a new dependency for just
   bold/italic/code/links? A hand-rolled parser could cover the row preview
   but would need real CommonMark compliance for the full view panel.
4. Support GFM extensions (tables, task lists, strikethrough, autolinks),
   or restrict to plain CommonMark for a smaller, safer surface?
5. The row preview currently shows quotes (`"…"`) around strings, which is
   the only visual cue distinguishing an empty string, a string of pure
   whitespace, or a string that happens to look like a number, from other
   kinds at a glance. Once quotes are dropped in favor of rendered
   Markdown, should some other cue (e.g. the existing `tree-row__icon`
   type marker) be relied on exclusively, or does empty/whitespace content
   need special-cased preview text (e.g. an italic `Empty`)?

## Suggested implementation sequence

1. Add the Markdown dependency and `src/domain/markdown.ts` with
   `renderInline`/`renderBlock`, plus unit tests including the security
   fixtures above.
2. Swap the row preview for string nodes to use `renderInline`, leaving
   selection/edit behavior unchanged, and confirm truncation/ellipsis still
   holds.
3. Add the `"view"` panel mode, wire it into the existing one-panel-at-a-time
   rule, and change string-row selection to open it (pending resolution of
   Open Question 2).
4. Add view-panel styling, then accessibility and regression tests.
5. Update `docs/design.md` 6.1/6.2 to describe the new string preview and
   view/edit split once implemented.
