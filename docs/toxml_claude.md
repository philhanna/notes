# Plan: convert the `remember.json` backing store to XML

This is a planning document only. It does not change the current storage
format, domain model, or application behavior. It was written independently
by reading the current source tree (not `docs/toxml_codex.md`), so its
conclusions and open questions may differ from that document even where the
underlying problem is the same.

## 1. Goal

`remember.json` (`src/persistence/githubRepository.ts:29`, `DOCUMENT_PATH`)
stores the notes tree as plain JSON. Every value in memory is a raw
`JsonValue` (`src/domain/types.ts:9`) — a string, number, boolean, `null`,
plain array, or plain object — with no way to attach anything to an
individual node. JS primitives (`string`, `number`, `boolean`) cannot carry
extra properties at all, and a plain object/array node has no reserved slot
for one either, so the only way to record something about a specific node
today would be a second, path-keyed side structure kept in sync by hand.

The goal is to replace `remember.json` with `remember.xml`, and to change
the in-memory representation from plain `JsonValue` to a small node type
that has a place for that per-node information (as XML attributes on the
node's element), so it moves, copies, and is deleted with the node
automatically instead of needing separate synchronization logic.

No specific metadata field is being designed here. `docs/key_history_design.md`
proposed one (a per-key last-modified timestamp) and was deleted from the
repository before this plan was written (commit `7ae07e4`), so this plan
does not assume that or any other specific field is still wanted. It only
makes attribute storage possible; a later, separate plan can define what
goes in the attributes.

## 2. Current state (what actually has to change)

Grounded in the source as of this writing, not assumptions:

- **Domain layer** (`src/domain/`) operates entirely on plain `JsonValue`.
  `tree.ts` is a set of pure functions (`getAtPath`, `listChildren`,
  `createObjectEntry`, `createArrayElement`, `renameKey`, `setValueAtPath`,
  `reorderArrayElement`, `removeEntry`, `deleteEntry`, `move`, `copy`) that
  read and immutably rewrite a `JsonObject` via a recursive `replaceAt` that
  clones each container along the path (`src/domain/tree.ts:106-128`).
  There is no wrapper type anywhere in this file.
- `tree.ts`'s `listChildren` sorts object keys alphabetically for display
  (`Object.keys(value).sort()`, `src/domain/tree.ts:57`) regardless of the
  object's actual property order. Array order is used as-is. This means the
  UI never depends on JS object insertion order — only on array order — even
  though `serializeDocument` (`src/domain/serialize.ts:18`, plain
  `JSON.stringify`) does preserve whatever insertion order happens to be in
  memory when it writes the file.
- `diff.ts`'s `changedPaths`/`deepEqual` compare objects by key set
  (`new Set([...Object.keys(before), ...Object.keys(after)])`,
  `src/domain/diff.ts:27`), not by position, so object order is not
  semantically load-bearing for conflict detection either.
- `search.ts`, `treeViewState.ts` (`deriveVisibleTree`,
  `VisibleTreeNode.value: JsonValue`), `inference.ts` (`inferValue` returns a
  raw `JsonValue` from typed text), and the components that read
  `node.value`/call `JSON.stringify(node.value)` for display
  (`src/components/TreeRow.tsx:263-266`, `src/components/ValueEditor.tsx:60`)
  all assume a value is exactly its plain JSON representation.
- **Persistence layer**: `Repository.loadDocument`/`save` pass a
  `JsonObject` straight through (`src/persistence/repository.ts:29-52`).
  `githubRepository.ts` reads/writes `remember.json` via the Git Data API
  (blob → tree → commit → conditional ref update,
  `src/persistence/githubRepository.ts:194-264`) and already has a
  documented, tested strategy for an uncertain ref-update response
  (re-read the head and compare SHAs rather than blindly retrying,
  `githubRepository.ts:246-262`). `inMemoryRepository.ts` mirrors the same
  contract for tests.
- **No object order guarantee is documented.** `docs/design.md` §5.4 says
  only "Object key spelling and array order are preserved" — it does not
  claim object order is preserved, and nothing in the app currently depends
  on it (see above). This matters for §5.2 below.
- **No XML dependency exists.** `package.json` has no XML parsing library.
  The app already runs under `jsdom` for tests (`vitest.config.ts`) and in
  real browsers for production, and both environments provide `DOMParser`
  and `XMLSerializer` natively, so a codec can be built without adding a
  runtime dependency.
- **An external consumer already reads/writes `remember.json` directly**:
  `docs/python_cli.md` documents a Python script that talks to the same
  GitHub Git Data API endpoints as `githubRepository.ts`, parses
  `remember.json` as JSON, and writes it back with `json.dumps(..., indent=2)
  + "\n"`. This script has no code presence in this repository, but it is a
  real, documented client of the current format and must not be ignored when
  planning the switch (§10).
- **The app already has a version-refresh mechanism**: `docs/design.md` §13
  states "The PWA detects a newly deployed client version and requests a
  safe refresh without discarding an in-progress edit." This already exists
  for reasons unrelated to this migration, but it is directly useful for
  reducing how much of the migration's own safety net (§9) needs to be
  reinvented.

## 3. Scope and decisions

- `remember.xml` becomes the sole authoritative document; `remember.json`
  is retired once migration has run (see §9 for the exact mechanics).
- The user-visible data model is unchanged: one object root, containing
  objects, arrays, strings, numbers, booleans, and null, with case-
  insensitive, case-preserving object keys (`src/domain/keys.ts`) and
  significant array order.
- `Path` and JSON Pointer encoding (`src/domain/path.ts`) are unchanged.
  They already address a value by object keys and array indices, not by any
  serialization detail, so nothing about switching the backing format
  affects them.
- JSON remains the export format (`src/app/exportDocument.ts`). Export
  projects the in-memory node tree back to a plain `JsonObject` and excludes
  every attribute — this is unchanged from today's behavior, since today's
  document already has nothing beyond values to exclude.
- **Object entry order is preserved as-is, not canonicalized.** An
  alphabetical canonical order was considered, since §2 shows nothing in the
  app actually depends on it — but reordering existing keys is an unrelated,
  user-visible change to every export and every commit diff, and this
  migration's only justified purpose is making attribute storage possible.
  Whatever order an object's entries are in when loaded is the order they
  are written back in, exactly as `JSON.stringify` does today.
- Git remains the sole persistence and recovery mechanism. Each mutation
  still produces one conditional commit (`docs/design.md` §7.4, §9).
- No XML namespaces. `remember.xml` is never read or written by anything
  except this app's own codec (and, if updated in step with this migration,
  the Python CLI in §10) — it is not a public interchange format, and
  `docs/design.md` §3 is explicit that there is no other system, application
  server, or third-party integration that touches this file. Namespace
  machinery exists to let independent writers coexist without colliding on
  attribute names; there is exactly one writer here. A flat, fixed set of
  reserved attribute names is simpler to parse and serialize with
  `DOMParser`/`XMLSerializer` and is revisited only if a second writer is
  ever introduced.

## 4. XML document format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<document format="1">
  <entry key="where-was-i" type="string">desk</entry>
  <entry key="shell" type="object">
    <entry key="aliases" type="array">
      <item type="string">git status</item>
      <item type="boolean">true</item>
      <item type="null"/>
    </entry>
  </entry>
</document>
```

Rules:

- `<document>` is the file envelope, carrying `format="1"`. It is not itself
  a note node; the root note is always an object, whose entries are
  `<document>`'s direct children.
- An object's children are `<entry>` elements, each with exactly one `key`
  attribute, in document order equal to in-memory entry order (§3).
- An array's children are `<item>` elements, unkeyed, in document order
  equal to array order.
- Both element kinds carry `type`, one of `object`, `array`, `string`,
  `number`, `boolean`, or `null` — this reuses the existing `ValueKind`
  union (`src/domain/types.ts:18`) verbatim, so the codec's `type` values
  and the app's own `kindOf()` (`types.ts:48`) never disagree by
  construction.
- `object`/`array` elements contain only child elements (`<entry>`/`<item>`
  as appropriate for the child's own container kind is not required — an
  array containing an object still uses `<item type="object">` for that
  element, with `<entry>` children inside it).
- `string`/`number` elements contain text content and no children.
  `boolean` text is exactly `true` or `false`. `null` elements are always
  self-closing with no text.
- Any additional attribute beyond `key`/`type` is a metadata attribute:
  opaque to the codec's structural validation, preserved verbatim through
  load/save, and not interpreted by any code introduced in this plan (§1,
  §8). No metadata attribute names are reserved yet.
- Comments, processing instructions, CDATA, DTDs, and entity declarations
  are rejected by the parser (§6) — the app never needs them, and DTD/entity
  parsing is also a well-known XML XXE/billion-laughs attack surface that is
  simplest to close by refusing to walk it at all, consistent with
  `docs/design.md` §13's general stance that a malformed repository state
  must fail closed rather than be partially interpreted.

### 4.1 Strings and keys XML 1.0 cannot represent directly

`docs/design.md` §5.2 explicitly allows keys with "spaces, punctuation, `/`,
`~`, and shell metacharacters," and the value editor
(`src/components/ValueEditor.tsx`) accepts arbitrary typed text as a string
verbatim when it is not valid JSON (`src/domain/inference.ts:18-25`) — there
is no character filtering anywhere on the input path. A JS string can
therefore contain XML 1.0's forbidden control characters (most C0 controls
other than tab/LF/CR) or an unpaired UTF-16 surrogate, neither of which XML
1.0 can represent as ordinary text or attribute content.

Encode losslessly rather than rejecting or silently narrowing these values:

- When a `key` or a scalar's text would be unsafe or non-round-tripping in
  XML, encode the raw UTF-16 code units of the JS string as little-endian
  bytes, then standard base64, and mark it with a sibling
  `key-encoding="utf16le-base64"` or `encoding="utf16le-base64"` attribute.
  This must operate on UTF-16 code units, not `TextEncoder`'s UTF-8 output —
  `TextEncoder` replaces lone surrogates with U+FFFD, which is not lossless.
- This is the only reserved value for `key-encoding`/`encoding` in v1.
- Everything else uses ordinary XML text/attribute escaping.

## 5. In-memory domain model

Add a `NoteNode` type, most naturally in `src/domain/types.ts` next to the
`JsonValue`/`ValueKind` types it reuses:

```ts
export interface NoteNode {
  type: ValueKind;
  value: string | number | boolean | null; // meaningful only for scalar types
  entries: readonly NoteEntry[];           // meaningful only for type === "object"
  items: readonly NoteNode[];              // meaningful only for type === "array"
  attributes: Readonly<Record<string, string>>; // metadata only; never "key"/"type"
}

export interface NoteEntry {
  key: string;
  node: NoteNode;
}
```

A single interface with unused-by-kind fields (rather than a five-way
discriminated union) is a deliberate simplification: nearly every call site
in `tree.ts` already branches on `type`/`kindOf()` the same way it branches
on `isJsonObject`/`isJsonArray` today, and a discriminated union would force
every one of those call sites to narrow before it could read `.attributes`,
which every node has regardless of kind. The cost is that `value`/`entries`/
`items` are not mutually exclusive at the type level; `fromJsonValue`/
`toJsonValue` (below) are the only place that constructs a `NoteNode`, so
this is enforced by construction rather than by the type checker.

Add pure conversion helpers alongside it:

- `fromJsonValue(value: JsonValue): NoteNode` — wraps a plain value with
  empty `attributes` at every level. Used for pasted/typed input
  (`inference.ts`) and for the one-time JSON migration (§9).
- `toJsonValue(node: NoteNode): JsonValue` — the inverse, dropping every
  `attributes` map. Used by `exportDocument.ts` and by the JSON-projection
  equality check the migration performs (§9.2).

## 6. Codec

Replace `src/domain/serialize.ts`'s JSON-specific `parseDocument`/
`serializeDocument` with an XML-specific pair, keeping the existing
`ParseError` shape's spirit (a `kind` discriminant plus a `Path` for
location) so `src/components/errors.ts`'s existing malformed-document
handling needs minimal changes:

- `parseXmlDocument(text: string): Result<NoteNode, ParseError>`
- `serializeXmlDocument(root: NoteNode): string`

Parsing uses `DOMParser` (`text/xml` mode, whose `parseerror` element or
thrown error becomes a `{ kind: "syntax" }` result) followed by an
application-owned recursive walk that enforces every rule in §4: root
element name and `format` value, exactly one `type` per element from the
`ValueKind` set, `key` required on and only on `<entry>`, `<item>` never
carrying `key`, container elements holding only element children, scalar
elements holding only text, case-insensitive duplicate-key rejection within
one object (reusing `keysEqualIgnoreCase`,
`src/domain/keys.ts:5`), and decoding of `key-encoding`/`encoding` markers.
Reject a document above a fixed size/depth/node-count budget before or
during the walk, since a hostile or corrupted `remember.xml` should fail
closed rather than exhaust memory.

Serialization is hand-written, not `XMLSerializer.serializeToString`,
because the exact formatting (indentation, attribute order, self-closing
choice) needs to be deterministic across serializations of the same tree so
that commits contain meaningful content changes rather than incidental
formatting churn — the same reasoning `serializeDocument`'s doc comment
gives today for JSON's two-space indentation (`src/domain/serialize.ts:12-17`).
Fixed rules: UTF-8 declaration, `\n` line endings, one trailing newline,
two-space indentation, attributes in the order `key`, `key-encoding`,
`type`, `encoding`, then metadata attributes in the order they appear on the
in-memory node (no reordering, matching §3's "no canonicalization" stance),
and one consistent self-closing convention for empty elements.

## 7. Call sites that change

Every one of these currently imports `JsonObject`/`JsonValue`/`isJsonObject`/
`isJsonArray`/`isJsonScalar`/`kindOf` from `src/domain/types.ts` and needs
its equivalent operating on `NoteNode`:

| File | Current | Change |
| --- | --- | --- |
| `src/domain/tree.ts` | Every exported function takes/returns `JsonObject`/`JsonValue` | Retype to `NoteNode`; `replaceAt` clones a `NoteNode`'s `entries`/`items` array instead of a plain object/array; `listChildren`'s alphabetical `.sort()` (`tree.ts:57`) stays, since display order was already independent of storage order (§2) |
| `src/domain/diff.ts` | `changedPaths`/`deepEqual` walk `JsonValue` | Walk `NoteNode`; decide whether an `attributes`-only change at an otherwise-equal node counts as a changed path (needed once any code writes attributes — v1 can compare `attributes` for equality alongside `value`/entries so this is correct by default, deferring only the *policy* question to whatever later plan adds real metadata) |
| `src/domain/search.ts` | `buildSearchIndex` walks `JsonObject`, indexes scalar values via `scalarText` | Walk `NoteNode`; index only `type`/`key`/scalar `value`, never `attributes` — `docs/design.md` §11 defines search over keys, values, and breadcrumbs, not metadata |
| `src/domain/inference.ts` | `inferValue` returns a raw `JsonValue` | Returns `fromJsonValue(JSON.parse(...))` or a scalar `NoteNode` for the string fallback |
| `src/app/treeViewState.ts` | `VisibleTreeNode.value: JsonValue`; `deriveVisibleTree` walks `JsonObject` | `value: NoteNode`; walk `NoteNode`; `kindOf(value)` becomes `value.type` |
| `src/app/useDocument.ts` | `DocumentState.document: JsonObject`; every mutator's `Recompute` returns `Result<JsonObject, TreeError>` | `document: NoteNode`; `Recompute` returns `Result<NoteNode, TreeError>` |
| `src/app/exportDocument.ts` | `exportDocument(document: JsonObject)` calls `serializeDocument` | Calls `serializeJsonExport(toJsonValue(document))` — the export format itself is unchanged (§3) |
| `src/persistence/repository.ts` | `LoadedDocument.document: JsonObject`; `save(state: { document: JsonObject }, ...)` | Both become `NoteNode` |
| `src/persistence/githubRepository.ts` | `DOCUMENT_PATH = "remember.json"`; `parseDocument`/`serializeDocument` calls | `DOCUMENT_PATH = "remember.xml"`; calls become `parseXmlDocument`/`serializeXmlDocument`; `ensureDocument`'s empty-document literal (`githubRepository.ts:126,163,190`) becomes `fromJsonValue({})` | 
| `src/persistence/inMemoryRepository.ts` | Same JSON round-trip via `parseDocument(serializeDocument(...))` (`inMemoryRepository.ts:81`) as a cheap deep-clone-plus-validate | Same pattern with the XML functions, or an explicit structural clone of `NoteNode` if that is simpler — either preserves the existing "round-trip through serialization" validation behavior |
| `src/components/TreeRow.tsx` | `JSON.stringify(node.value)` for the value preview (`TreeRow.tsx:263-266`) and as `ValueEditor`'s `initialText` (`TreeRow.tsx:404`) | `JSON.stringify(toJsonValue(node.value))`, so the visible preview/edit text is unchanged even though `node.value` is now a `NoteNode` |
| `src/components/CreateEntryForm.tsx`, `ValueEditor.tsx` | Pass `inferred.value: JsonValue` straight to `onCreateEntry`/`onSubmit` | Unchanged in shape once `inferValue` returns a `NoteNode` (§7 row above) — these components don't otherwise inspect the value |

`src/domain/path.ts`, `src/domain/keys.ts`, and
`src/persistence/commitMessage.ts` are untouched: they operate on `Path`
(object keys/array indices) or `Operation` (which is already value-free by
design, `docs/design.md` §9), neither of which encodes a value's
representation.

## 8. Metadata attributes

This plan stops at making `attributes` exist and round-trip correctly. It
deliberately does not:

- reserve any attribute name for application use,
- define who sets an attribute or when,
- decide how a rename/move/copy/reorder should treat existing attributes
  (though §7's `NoteNode`-cloning `replaceAt` naturally carries whatever is
  in `attributes` along with the node, so "preserve by default" falls out
  of the data structure without extra code),
- expose any attribute in the UI.

A future plan (for example, a revival of `docs/key_history_design.md`'s
idea) can build entirely on top of §5–§7 by adding one reserved attribute
name and the read/write policy for it, without touching the codec, the
tree/diff/search refactor, or the persistence layer again.

## 9. Persistence and migration

### 9.1 File-state handling

`loadDocument`/`ensureDocument` (`githubRepository.ts:89-192`) must handle:

| Repository state | Result |
| --- | --- |
| `remember.xml` present, valid | Load it. `remember.json`'s presence or absence is irrelevant once `remember.xml` exists. |
| `remember.xml` present, malformed | Fail as malformed. Never fall back to `remember.json` — a stale/incomplete migration must not silently resurrect old data. |
| No `remember.xml`, valid `remember.json` | Parse it, convert with `fromJsonValue`, and perform the one-time migration below. |
| No `remember.xml`, malformed `remember.json` | Fail as malformed, same as today's behavior for a corrupt `remember.json` — do not treat it as a fresh repository. |
| Neither file (brand-new repository) | `ensureDocument` creates an empty `remember.xml` directly; no migration needed. |

### 9.2 One-time migration

One conditional commit, following the same base-SHA pattern `save` already
uses (`githubRepository.ts:194-264`):

1. Read and validate `remember.json`, exactly as `loadDocument` does today.
2. `fromJsonValue` it, serialize to XML, parse that XML back, and assert
   `toJsonValue(reparsed)` is deeply equal to the original — this both
   proves the codec round-trips this specific document and catches a codec
   bug before it ever reaches Git, rather than after.
3. Create the `remember.xml` blob and, in the same tree/commit, remove
   `remember.json` (a plain deletion — see below for why not a tombstone).
4. Commit conditionally on the head SHA `remember.json` was read at, same
   as any other save. On a lost race (someone else committed first), reload
   and re-evaluate the table in §9.1 rather than retrying blindly, matching
   the existing uncertain-write handling.

### 9.3 Why a plain delete, not a tombstone

An XML migration for a multi-writer or long-tail-of-old-clients system
typically leaves a deliberately-invalid `remember.json` behind so that an
old client fails loudly instead of silently starting a second, divergent
document. That risk does not really apply here: `docs/design.md` §13
already gives this specific app a mechanism to avoid it — the PWA "detects a
newly deployed client version and requests a safe refresh." Combined with
this being a single-user app with one deployed origin
(`docs/design.md` §3.3, "GitHub Pages... reveals only the application shell
and sign-in screen"), the realistic risk window is one user's one browser
tab, open across a deploy, that has not yet been prompted to refresh — and
`ensureDocument`'s "create only when absent" behavior can't be tricked into
reintroducing `remember.json`, since the migration removes it rather than
leaving it present-but-invalid. A plain deletion is simpler to implement,
test, and explain, at the cost of relying on the refresh mechanism actually
firing before that one stale tab tries to save. If that assumption turns
out to be wrong in practice, a tombstone can be added later without
revisiting anything else in this plan.

### 9.4 Persistence changes

- `DOCUMENT_PATH` → `"remember.xml"` in `githubRepository.ts`.
- `loadDocument`/`ensureDocument`/`save` read/write `NoteNode` instead of
  `JsonObject`; `save`'s tree-entry list needs a second entry (the
  `remember.json` deletion) only during the one-time migration path, not on
  ordinary saves.
- `inMemoryRepository.ts` gets the same file-state/migration behavior
  exercised in `src/persistence/repository.contract.test.ts` (currently 256
  lines covering the shared `Repository` contract), so both adapters are
  proven to agree.
- Setup/error copy that currently names `remember.json`
  (`docs/design.md` §9.1, any component-level strings) is updated to name
  `remember.xml`.

## 10. External consumers

`docs/python_cli.md`'s example script reads and writes `remember.json`
directly via the same Git Data API endpoints `githubRepository.ts` uses. It
is not part of this repository's build or tests, but it is real documented
guidance a user could be relying on. This plan's rollout is incomplete
without either:

- updating `docs/python_cli.md`'s example to speak `remember.xml` using
  Python's standard-library `xml.etree.ElementTree` (sufficient for the
  format in §4; no third-party XML dependency needed there either), or
- explicitly documenting, before the migration ships, that any such script
  must be updated in lockstep with the app, since after migration
  `remember.json` no longer exists to read.

## 11. Test plan

- **Codec** (replacing/extending `src/domain/serialize.test.ts`, currently
  73 lines): round-trip every `ValueKind`, nested containers, empty
  containers, empty strings; preserve key spelling and entry/array order;
  escape ordinary XML metacharacters; round-trip the base64 fallback for
  control characters and lone surrogates in both keys and values; reject
  wrong root/format, DTDs, entities, mixed content, malformed base64,
  duplicate keys (case-insensitive), a `key` on `<item>` or a missing `key`
  on `<entry>`, and invalid `type`/scalar spellings; assert serialize/parse
  is idempotent on its own output; assert size/depth/node-count limits are
  enforced.
- **Domain** (extending `src/domain/tree.test.ts`, currently 512 lines, and
  `diff.test.ts`/`search.test.ts`): rerun every existing tree-operation test
  against `NoteNode`; add cases proving `attributes` survives rename, move,
  copy, and reorder unchanged (falls out of §5's design, but should be
  asserted, not assumed); confirm `search`/`buildSearchIndex` never surface
  `attributes` content.
- **Persistence** (extending
  `src/persistence/repository.contract.test.ts`, currently 256 lines):
  cover every row of §9.1's table against both `githubRepository` and
  `inMemoryRepository`; migrate a real JSON fixture and assert the XML
  projection is exactly equal via `toJsonValue`; confirm a lost migration
  race reloads and re-evaluates rather than double-migrating; confirm
  malformed XML never falls back to JSON.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`,
  `npm run build`, and the relevant Playwright flows under `e2e/` before
  rollout, matching the existing CI gates in `.github/workflows/ci.yml`.

## 12. Documentation and rollout checklist

- Update `docs/design.md` §5.4 and §9 (JSON backing-store language →
  `remember.xml`/node model), `docs/requirements.md`, `docs/impl.md`, and
  `README.md`'s references to `remember.json`.
- Update `docs/python_cli.md` per §10.
- Document the final XML schema and the base64 fallback encoding wherever
  `docs/design.md` documents the current JSON format, so a future reader
  doesn't have to reconstruct it from the codec's source.
- Note in rollout communication (commit message / changelog entry, per this
  repo's `CHANGELOG.md` convention) that this is a one-way migration: once
  `remember.xml` exists, an older deployed build cannot read the repository
  at all.

## 13. Open decisions to confirm before implementation

- **§3's "preserve existing object order" vs. canonicalizing it.** This
  plan recommends preserving it (smallest, most justifiable diff), but it's
  worth confirming that's actually wanted rather than assumed.
- **§3's "no XML namespaces" decision.** Recommended because there is
  exactly one writer of this file today; worth confirming that remains true
  before committing to a scheme that would need revisiting if a second
  writer (beyond the Python CLI, which can simply be updated) ever appears.
- **§9.3's "plain delete, no tombstone" decision**, which trades a small
  amount of safety margin for significantly less migration complexity by
  leaning on `docs/design.md` §13's existing refresh mechanism. Worth
  confirming that mechanism is trusted enough for this to be acceptable.
- **§8's scope cutoff.** This plan defines the mechanism and deliberately
  no policy. Confirm that's the right split, versus folding a specific
  metadata field's semantics into the same implementation effort.

## 14. Completion criteria

- A legacy JSON repository migrates to `remember.xml` without changing any
  key, value, type, or array order observable through JSON export.
- Every active note lives in one canonical `remember.xml`; `remember.json`
  no longer exists after migration.
- Every existing domain/persistence/UI behavior (§7's table) is proven
  equivalent against the new `NoteNode` model by the tests in §11.
- `docs/python_cli.md`'s guidance is either updated or explicitly
  superseded before rollout (§10).
- All codec, domain, persistence, UI, build, and end-to-end checks in §11
  pass.
