# Plan: migrate the backing document from JSON to XML

## 1. Goal

Replace the repository's authoritative `remember.json` document with
`remember.xml`. XML gives every note node a place to carry metadata as
attributes, so metadata moves, copies, and is deleted with the node instead of
being maintained in a separate path-keyed sidecar.

This document is an implementation plan only. It does not change the current
storage format or application behavior.

## 2. Scope and decisions

- `remember.xml` becomes the only authoritative active-tree document.
- The user-visible data model remains the same: an object root containing
  objects, arrays, strings, numbers, booleans, and null.
- Object keys retain their spelling and case-insensitive uniqueness rules.
- Array order remains significant.
- Existing `Path` values and JSON Pointer display/URL encoding remain the
  addressing API. XML element indexes are not exposed as paths.
- The in-memory model becomes node-based so metadata is attached to a node, not
  reconstructed as a path-keyed map.
- JSON remains the user export format. Export projects the node tree back to a
  plain `JsonObject` and excludes all metadata.
- `remember.meta.json`, proposed by `docs/key_history_design.md`, is not created.
  The XML node attributes supersede that proposed representation.
- Git remains the sole persistence and recovery mechanism. Each mutation still
  produces one conditional commit.
- The first XML version supports the `modified` metadata described in
  `docs/key_history_design.md`, but the parser preserves unknown namespaced
  metadata attributes for forward compatibility.

## 3. XML representation

### 3.1 Version 1 vocabulary

Use a small application-specific vocabulary rather than turning object keys
into element names. Keys may contain characters that are not legal XML names,
and a generic `node` element keeps objects and arrays uniform.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<remember xmlns="urn:remember:document:1"
          xmlns:m="urn:remember:metadata:1"
          format="1">
  <node type="object">
    <node key="where-was-i"
          type="string"
          m:modified="2026-07-10T14:32:00Z">desk</node>
    <node key="shell" type="object">
      <node key="aliases" type="array">
        <node type="string">git status</node>
        <node type="boolean">true</node>
        <node type="null"/>
      </node>
    </node>
  </node>
</remember>
```

The rules are:

- `remember` is a format envelope and is not itself a note node. It has exactly
  one `node` child.
- The root note has `type="object"` and no `key`.
- Every object child has exactly one `key` attribute.
- Array children have no `key`; their document order is their array order.
- `type` is exactly one of `object`, `array`, `string`, `number`, `boolean`, or
  `null`.
- Object and array nodes contain only child `node` elements.
- String and number nodes contain character data and no child elements.
- Boolean text is exactly `true` or `false`.
- Null nodes contain no text or child elements.
- Comments, processing instructions, CDATA sections, DTDs, entity declarations,
  mixed content, and elements outside the version-1 namespace are rejected.
- Unqualified attributes are structural and accepted only when the schema
  defines them. Metadata attributes must be namespace-qualified.
- Version 1 metadata uses `m:modified` with a canonical ISO 8601 UTC value.
  Metadata namespaces and local names are stored independently of the source
  file's chosen namespace prefix.

Do not use XML attributes for note values. Attribute whitespace normalization
would make some strings impossible to round-trip, and large values are clearer
as element text.

### 3.2 Strings that XML 1.0 cannot represent directly

The current JSON model permits keys and strings containing control characters
and JavaScript unpaired UTF-16 surrogates. XML 1.0 cannot directly represent all
of those values, and XML parsers normalize line endings and some attribute
whitespace. Migration must be lossless rather than silently narrowing the
existing domain.

Use the ordinary escaped XML representation when it round-trips exactly.
Otherwise encode the original JavaScript UTF-16 code units as little-endian
bytes and then standard padded base64:

```xml
<node key="YQANAGIA"
      key-encoding="utf16le-base64"
      type="string"
      encoding="utf16le-base64">YwAAAGQA</node>
```

The exact example bytes must be verified when codec tests are written; it is
illustrative here. The normative rules are:

- `key-encoding` applies to `key`; `encoding` applies to string content.
- The only version-1 encoded form is `utf16le-base64`.
- Encode a key when a conforming XML parser would normalize it or reject any
  code unit, including tabs, line breaks, carriage returns, forbidden XML
  characters, or unpaired surrogates.
- Encode string content when XML parsing would normalize or reject it,
  including carriage returns, forbidden XML characters, or unpaired
  surrogates. Tabs and line feeds are safe in element text.
- Reject an encoding marker on an incompatible node type, malformed base64,
  odd decoded byte length, or a non-canonical base64 spelling.
- Never use `TextEncoder` for this fallback because it replaces unpaired
  surrogates and would not be lossless.

Ordinary XML escaping still applies to direct text and attributes:
`&`, `<`, `>`, and attribute quotes are emitted as entities as needed.

### 3.3 Canonical serialization

Implement one serializer and make its output deterministic:

- UTF-8 with the XML declaration shown above;
- `\n` line endings and one trailing newline;
- two-space indentation for container children;
- fixed namespace declarations and prefixes;
- structural attributes in the order `key`, `key-encoding`, `type`,
  `encoding`, followed by metadata attributes sorted by namespace URI and
  local name;
- object children in their in-memory insertion order and array children in
  array order;
- canonical JSON-compatible number spelling, rejecting non-finite numbers;
- no insignificant text nodes inside containers other than serializer
  indentation; and
- one stable choice between self-closing and explicit empty tags for each
  node kind.

Parsing does not depend on attribute order, namespace prefix, indentation, or
the serializer's self-closing choice. Serializing any successfully parsed
document normalizes it to the canonical form.

## 4. In-memory domain model

Introduce a node model in `src/domain/types.ts` along these lines:

```ts
type NodeMetadata = ReadonlyMap<ExpandedName, string>;

type NoteNode =
  | { type: "object"; children: ObjectChild[]; metadata: NodeMetadata }
  | { type: "array"; children: NoteNode[]; metadata: NodeMetadata }
  | { type: "string"; value: string; metadata: NodeMetadata }
  | { type: "number"; value: number; metadata: NodeMetadata }
  | { type: "boolean"; value: boolean; metadata: NodeMetadata }
  | { type: "null"; value: null; metadata: NodeMetadata };

interface ObjectChild {
  key: string;
  node: NoteNode;
}
```

`ExpandedName` represents a namespace URI plus local name, not a serialized
prefix. Exact readonly/mutable choices can follow the existing immutable tree
operations.

This makes key order explicit and lets rename change the `ObjectChild.key`
without rebuilding an object. More importantly, a move relocates the same
logical node and its metadata, a copy deep-clones both content and metadata,
and a delete removes both together. Array reordering needs no metadata path
remapping.

Add conversion helpers at the compatibility boundaries:

- `fromJsonObject(JsonObject): NoteNode` recursively wraps imported or pasted
  JSON values with empty metadata.
- `toJsonObject(NoteNode): JsonObject` validates an object root and strips
  metadata for JSON export.

Do not retain a path-to-metadata map as the primary model. It would reproduce
the synchronization and array-index remapping work that XML is intended to
remove.

## 5. Metadata behavior

Implement metadata policies in the domain layer, not in the serializer.
Serialization only persists the metadata already present on a node.

For the initial `m:modified` field:

| Operation | Metadata behavior |
| --- | --- |
| Create a scalar | Set `m:modified` to the operation timestamp. |
| Create a container | Do not set `m:modified`. Descendant scalars created from pasted JSON receive the same operation timestamp. |
| Set a scalar value | Set that node's `m:modified` to the operation timestamp. |
| Replace scalar/container shape | Apply creation rules to the replacement tree. |
| Rename | Preserve all metadata. |
| Move | Preserve all metadata. |
| Copy | Deep-copy all metadata unchanged, matching `docs/key_history_design.md`. |
| Reorder | Preserve all metadata. |
| Delete | Delete the node and its metadata. |

Capture the operation timestamp once before the first save attempt. Reusing it
when conflict reconciliation reapplies an operation prevents network retries
from changing persisted content.

Migration from JSON leaves `m:modified` absent. Do not invent modification
times from the migration time or Git commit history. The UI must tolerate a
missing timestamp.

Known metadata is validated by its policy. Unknown namespaced metadata
attributes are preserved through load, edit, move, copy, save, and conflict
retry so an older client does not erase fields introduced by a newer client.
Unknown unqualified attributes remain an error because they may change format
semantics.

## 6. XML codec

Replace the JSON backing-store codec in `src/domain/serialize.ts` with clearly
separated APIs, for example:

- `parseXmlDocument(text): Result<NoteNode, ParseError>`
- `serializeXmlDocument(root): string`
- `parseJsonDocument(text): Result<JsonObject, ParseError>` retained only for
  migration and JSON-facing input
- `serializeJsonExport(root): string`

Use the browser's XML parser for syntax and namespace handling, followed by a
strict recursive schema validator. Use an application-owned serializer rather
than `XMLSerializer`, whose formatting and empty-element output are not the
canonical storage contract.

The parser must:

- reject a document larger than an explicit configured limit before parsing;
- reject DTDs and entity declarations before walking node content;
- detect the parser's syntax-error result;
- require the exact supported document namespace and format version;
- enforce parent-specific key rules and type-specific content rules;
- reject duplicate object keys case-insensitively;
- reject non-canonical or non-finite numbers and invalid booleans;
- decode fallback strings losslessly;
- validate known metadata without discarding unknown namespaced metadata; and
- return path-aware errors suitable for the existing malformed-document UI.

Add a depth/node-count guard during recursive validation and serialization to
avoid stack or memory exhaustion on a hostile repository file.

## 7. Domain and application refactor

Complete the refactor in small, testable slices:

1. Add `NoteNode`, metadata, JSON projection, and fixture builders while leaving
   current JSON persistence in place.
2. Port `src/domain/tree.ts`, `search.ts`, `diff.ts`, and their tests to operate
   on nodes. Keep the public `Path` contract unchanged.
3. Update `ChildEntry` and the React components to read node type/value/key
   through domain helpers rather than `JSON.stringify` or raw object access.
4. Update value inference and pasted JSON handling to wrap parsed JSON as
   metadata-bearing nodes.
5. Thread a single operation timestamp through `useDocument` and its
   conflict-recompute closure.
6. Make concurrency diffing consider both content and metadata. A metadata-only
   change at a path is a change at that path.
7. Change export to project the active node tree to JSON. Keep the current
   filename, MIME type, two-space formatting, and trailing newline.
8. Switch the repository boundary to XML only after all domain and UI tests pass
   against the node model.

## 8. Repository migration and rollout

### 8.1 File-state rules

Repository loading must handle these states explicitly:

| Repository state | Result |
| --- | --- |
| Valid `remember.xml` plus the expected JSON tombstone | Load XML. |
| Valid `remember.xml`, no `remember.json` | Load XML. |
| No XML, valid `remember.json` | Parse JSON and perform the one-time migration. |
| Neither file in a new repository | Initialize an empty XML document and JSON tombstone atomically. |
| XML and a still-valid JSON document both exist | Fail as ambiguous; do not pick one silently. |
| Malformed XML | Fail as malformed; never fall back to JSON. |
| No XML and malformed JSON | Fail as malformed; do not overwrite it. |

Once `remember.xml` exists, it is authoritative. Falling back to JSON after an
XML error could resurrect stale data.

### 8.2 One-time migration commit

The migration is one conditional Git commit based on the head SHA that supplied
the JSON:

1. Read and validate `remember.json`.
2. Convert it to a metadata-empty node tree.
3. Serialize XML and parse it again, then verify that its JSON projection is
   deeply equal to the source document.
4. Create the `remember.xml` blob.
5. Replace `remember.json` with a deliberately non-JSON UTF-8 tombstone such as
   `This repository has migrated to remember.xml. Update the notes app.`.
6. Put both blobs in the same Git tree and create a value-free commit named
   `Migrate notes storage to XML`.
7. Update the branch ref conditionally using the existing stale-writer path.
8. If the head changed, discard the attempted result, reload, and reevaluate the
   file-state table. Never migrate a JSON snapshot read from a stale head.

The invalid JSON tombstone is intentional. A stale version of the PWA must fail
closed with a malformed-document error instead of treating a missing
`remember.json` as a new store or continuing to write a second authoritative
document. Git history retains the pre-migration JSON for manual recovery.

After the XML release is established, a later maintenance change may delete the
tombstone. That cleanup is not part of this migration.

### 8.3 Persistence changes

- Change `DOCUMENT_PATH` in `src/persistence/githubRepository.ts` to
  `remember.xml` and introduce a separately named legacy JSON path.
- Extend repository load results and save state from `JsonObject` to the root
  `NoteNode`.
- Generalize tree-entry creation enough to write the XML document and migration
  tombstone atomically.
- Keep saves conditional on the branch head SHA, not a file blob SHA.
- Keep commit messages value-free.
- Update setup copy and errors to name `remember.xml`.
- Update the in-memory repository and fake Git graph to exercise the same
  migration/file-state rules as the GitHub adapter.

## 9. Test plan

### 9.1 Codec tests

- Round-trip every node kind, nested objects/arrays, empty containers, and empty
  strings.
- Preserve object key spelling/order and array order.
- Escape XML metacharacters in keys and values.
- Round-trip tabs, line feeds, carriage returns, forbidden XML controls,
  astral characters, and lone high/low surrogates.
- Round-trip finite number edge cases and define the canonical treatment of
  negative zero consistently with JSON export.
- Preserve namespaced unknown metadata while rejecting unknown structural
  attributes.
- Reject wrong namespaces/versions, DTDs, entities, mixed content, malformed
  base64, illegal key placement, duplicate keys, invalid scalar spellings,
  multiple roots, and non-object note roots.
- Assert byte-for-byte canonical output and parse/serialize idempotence.
- Assert depth, node-count, and input-size limits.

### 9.2 Domain and UI tests

- Run every existing tree operation against metadata-bearing nodes.
- Verify rename, move, reorder, and copy preserve metadata according to the
  policy table.
- Verify set/create timestamps are captured once across a conflict retry.
- Verify metadata-only concurrent changes participate in conflict detection.
- Verify search indexes only note keys and values, not metadata.
- Verify tree rows do not expose metadata unless a separately designed UI asks
  for it.
- Verify JSON export is byte-for-byte equivalent to the current export and
  contains no metadata or XML-specific fields.

### 9.3 Repository contract tests

- Migrate a valid legacy JSON file in one commit and compare the XML projection
  to the original.
- Confirm migration leaves no invented timestamps.
- Confirm a stale migration loses the ref race safely and retries from the new
  head.
- Cover every file-state-table branch.
- Confirm an XML save changes only `remember.xml`, remains conditional on the
  base SHA, and keeps value-free commit messages.
- Confirm malformed XML never triggers initialization or JSON fallback.
- Confirm a simulated stale client sees invalid JSON rather than an empty or
  valid legacy document.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, the
production build, and the relevant Playwright flows before rollout.

## 10. Documentation and rollout checklist

- Update `docs/design.md`, `docs/requirements.md`, `docs/impl.md`,
  `docs/python_cli.md`, and `README.md` from JSON backing-store language to the
  XML format and node model.
- Mark `docs/key_history_design.md` as superseded for representation while
  retaining its last-modified semantics.
- Document the XML schema, canonicalization rules, metadata namespace, and
  fallback encoding for non-XML strings.
- Update examples and external scripts to read/write `remember.xml` safely.
- Tell users that old application builds will intentionally stop at a malformed
  `remember.json` after migration and must be refreshed.
- Deploy the XML-capable reader before allowing migration, and retain a rollback
  build that can read XML. A rollback to a JSON-only build is unsafe after the
  first migration.

## 11. Completion criteria

The conversion is complete when:

- a legacy JSON repository migrates without changing any key, value, type, or
  order observable through JSON export;
- every active note is stored in one canonical `remember.xml`;
- node metadata survives all applicable edits without a sidecar map;
- stale JSON-only clients fail closed;
- malformed or ambiguous repository states never overwrite user data;
- concurrency and uncertain-write guarantees remain unchanged; and
- all codec, domain, repository, UI, build, and end-to-end checks pass.
