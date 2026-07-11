# Notes app implementation plan

## 0. Current status

As of the latest commit, the repository contains only documentation
(`docs/requirements.md`, `docs/design.md`, `docs/impl.md`, `docs/questions.md`,
`docs/remember.json`). A prior TypeScript vertical slice was built and then
intentionally deleted (commit `3c93594`) so implementation could restart
against this plan. No phase below has started.

- [ ] Phase 0 — Project foundation and risk spikes
- [ ] Phase 1 — Domain model and local tree browser
- [ ] Phase 2 — Authentication, setup, and basic persistence
- [ ] Phase 3 — Complete tree operations and trash
- [ ] Phase 4 — Concurrency and resilient saving
- [ ] Phase 5 — Search, history, restoration, and export
- [ ] Phase 6 — PWA hardening, accessibility, and release

Check off a phase only when every exit-criteria checkbox below it is checked,
not when its UI merely appears to work (see closing note in section 6).

## 1. Delivery strategy

Build the application as a series of usable vertical slices. Establish the
browser-only GitHub integration before investing heavily in the UI, then keep
all domain behavior independent of React and GitHub so it can be tested quickly
and deterministically.

Recommended stack:

- TypeScript with strict compiler settings;
- React and Vite for the static application;
- React Router for addressable tree locations;
- a small explicit state layer rather than a database-shaped client framework;
- Vitest and Testing Library for unit and component tests;
- Playwright for browser and PWA tests;
- ESLint and Prettier for static checks; and
- GitHub Actions and GitHub Pages for CI and deployment.

Use Web Crypto where cryptographic browser APIs are needed. Do not add a custom
backend, service worker data store, or client-side notes cache beyond the loaded
in-memory document and deliberately retained unsaved editor state.

## 2. Proposed code boundaries

Organize the implementation around replaceable, testable modules:

```text
src/
  domain/       JSON tree, paths, validation, mutations, trash, search
  persistence/  repository interface, GitHub adapter, serialization
  auth/         GitHub device flow and token lifecycle
  app/          application state and operation orchestration
  components/   responsive presentation and interaction
  pwa/          manifest, update handling, and service-worker registration
```

The domain layer must be pure TypeScript: an operation receives a document and
returns a new document or a typed error. The persistence layer must expose an
interface that can be backed by both an in-memory fake and GitHub. React
components should not call GitHub APIs or mutate JSON directly.

Represent locations internally as arrays of object keys and array indices.
Encode and decode JSON Pointer only at URL, repository metadata, and display
boundaries. This avoids accidental ambiguity for keys containing `/` or `~`.

## 3. Recommended phases

### Phase 0 — Project foundation and risk spikes

Create the Vite TypeScript project, quality gates, test harness, and a minimal
installable application shell. Record the supported Node and browser versions.

Before proceeding, prove the following against a disposable private repository:

1. A static browser application can complete the selected GitHub App device
   authorization flow, refresh authorization, and make authenticated API calls
   without a client secret or proxy.
2. The app can read the repository head and atomically commit both
   `remember.json` and `.trash/trash.json` by creating Git blobs, a tree, and a
   commit, then conditionally advancing the branch ref.
3. A stale writer cannot advance that ref and can distinguish a conflict from a
   network or authorization failure.
4. Required GitHub API calls work from the deployed Pages origin under browser
   CORS rules.

Use the Git Data API for multi-file writes; the Contents API alone cannot make
the active document and trash update one atomic commit. Capture request/response
fixtures with credentials and note content removed. If any spike fails, revise
the relevant design assumption before building dependent features.

Exit criteria:

- [ ] lint, type-check, unit test, build, and a smoke test run in CI;
- [ ] the app installs locally as a PWA and shows no note data while signed out;
- [ ] a documented spike demonstrates private-repository read and conditional,
  atomic write from the deployed origin; and
- [ ] secrets and tokens are absent from source, build artifacts, URLs, and logs.

### Phase 1 — Domain model and local tree browser

Implement deterministic parsing and serialization, path handling, and immutable
tree operations. Cover objects, arrays, all scalar types, case-insensitive object
key uniqueness with case preservation, and the value-input inference rules.

Build the first local UI using fixture data:

- browse immediate children and breadcrumbs;
- create and update scalars, objects, and arrays;
- rename object keys;
- append and reorder array elements; and
- show typed validation and confirmation errors without losing input.

Add keyboard-accessible controls from the beginning. Drag-and-drop may be added
later, but must not be the only way to reorder an array.

Exit criteria:

- [ ] every JSON value round-trips with deterministic formatting;
- [ ] special keys and JSON Pointer escaping are tested;
- [ ] duplicate keys differing only by case are rejected;
- [ ] the tree browser and editor work at phone and desktop widths; and
- [ ] domain tests cover success, invalid destination, replacement confirmation,
  and non-mutating failure paths.

### Phase 2 — Authentication, setup, and basic persistence

Implement GitHub authorization and repository setup. Keep tokens in per-device
browser storage, centralize authenticated requests, redact diagnostics, and
handle refresh, revocation, sign-out, and authorization expiry.

The setup flow should accept owner, repository, and branch; confirm that the
repository is private and writable; discover the repository's default branch;
and create `remember.json` only when it is absent. Persist non-secret repository
configuration separately from credentials.

Connect Phase 1 operations to GitHub. Each mutation should load against a known
head commit, produce and validate a complete new document, make one conditional
commit, and update local state only after success. Generate value-free commit
messages from structured operation metadata.

Exit criteria:

- [ ] a new device can authorize, select the dedicated repository, and reopen it;
- [ ] sign-out removes local authorization;
- [ ] setup never overwrites an existing document or changes repository visibility;
- [ ] all basic mutations create one valid commit each; and
- [ ] connectivity, rate-limit, authorization, malformed-data, and write errors are
  distinct and preserve the user's unsaved input.

### Phase 3 — Complete tree operations and trash

Implement copy, move, recursive delete, recovery, permanent deletion, and Empty
Trash. Enforce cycle prevention, destination validation, and no implicit
overwrite. Create a versioned trash schema with stable IDs, UTC timestamps,
original JSON Pointer paths, types, and complete deleted values.

Treat active-tree and trash changes as one persistence transaction. Recovery
must either restore the entire record and remove it from trash or do neither.
Add UI for choosing a new destination when the original path is occupied and
clearly explain that Empty Trash is not secure Git-history erasure.

Exit criteria:

- [ ] all operations are atomic at the Git commit level;
- [ ] recursive operations and cycle prevention have focused domain tests;
- [ ] malformed trash data fails safely without damaging the active document; and
- [ ] end-to-end tests cover delete, conflict on recovery, alternate destination,
  permanent deletion, and Empty Trash.

### Phase 4 — Concurrency and resilient saving

Introduce a structured operation log: retain the user's intended operation,
base commit, and affected source and destination paths until the save is known
to have succeeded. On a stale-head response, load the new tree and compare the
operation's affected paths with changes since its base.

Automatically reapply and retry once when changes do not overlap. For an
overlap, keep the pending input, explain which path changed, and require an
explicit retry after review. After a timeout or uncertain network result, reread
the branch head and operation metadata before retrying so the same user action
does not create duplicate commits. Use a client-generated operation ID in commit
metadata if necessary for reliable identification, but never include note values.

Exit criteria:

- [ ] two browser sessions cannot silently overwrite one another;
- [ ] disjoint edits are reapplied successfully;
- [ ] overlapping edits stop with recoverable local state; and
- [ ] timeout-before-response and timeout-after-commit cases do not duplicate an
  operation.

### Phase 5 — Search, history, restoration, and export

Build the in-memory search index after load and after each successful mutation.
Index keys, scalar text, and breadcrumbs; exclude trash and history. Confirm
acceptable interaction time using generated documents substantially larger than
the current sample before adding a search library.

Add history retrieval, path-based change detection, preview and comparison, and
restoration. Fetch historical versions lazily and bound concurrent GitHub calls
to avoid rate-limit bursts. Restore a selected scalar or container by applying
its historical value to the current document and creating a new commit; never
rewind the branch.

Implement active-tree JSON export as a local download with deterministic
formatting. Ensure trash, history metadata, credentials, and repository settings
are excluded.

Exit criteria:

- [ ] search is case-insensitive and returns correct breadcrumbs;
- [ ] history identifies revisions relevant to a selected path;
- [ ] preview does not alter current state;
- [ ] restoring one level leaves ancestors and siblings unchanged; and
- [ ] exported JSON exactly represents the active tree and parses successfully.

### Phase 6 — PWA hardening, accessibility, and release

Finalize the manifest, icons, install behavior, static-shell service worker, and
safe update prompt. Explicitly prevent the service worker and browser caching
configuration from storing authenticated API responses or notes. Preserve an
in-progress edit when connectivity drops or a new application version arrives.

Complete accessibility and responsive testing, including screen reader labels,
focus management after navigation and dialogs, keyboard-only tree operations,
reduced motion, contrast, and touch target sizes. Test on current Android Chrome
and a current Ubuntu Chromium-based browser, plus ordinary non-installed browser
use.

Configure GitHub Pages deployment with environment-specific public client
configuration, dependency and secret scanning, a restrictive Content Security
Policy where Pages permits it, and a documented rollback to the previous static
artifact.

Exit criteria:

- [ ] install, startup, upgrade, and rollback paths are tested;
- [ ] offline mode shows the shell and a clear read/write-unavailable state without
  exposing previously loaded notes after a fresh launch;
- [ ] automated acceptance tests pass against a disposable private repository from
  two browser sessions; and
- [ ] the release checklist verifies token redaction, repository scoping, no note
  data in deployed assets or diagnostics, and successful JSON export.

## 4. Testing approach

Maintain a test pyramid aligned with the module boundaries:

- **Domain tests:** table-driven and property-based tests for paths, casing,
  serialization, inference, every mutation, and invariants.
- **Persistence contract tests:** run the same cases against the in-memory fake
  and a mocked GitHub transport; separately run a small live-repository suite.
- **Component tests:** navigation, forms, validation, confirmation, preserved
  input, focus behavior, and error presentation.
- **End-to-end tests:** authorization seams, setup, CRUD, trash, conflict,
  uncertain writes, history, restoration, export, installation, and update.
- **Security checks:** secret scanning, dependency audit, CSP review, token and
  content redaction assertions, and inspection of browser storage and caches.

CI should require formatting, lint, type-check, unit/component tests, production
build, and browser smoke tests on every change. Run live GitHub integration tests
on protected branches or a scheduled workflow using a dedicated repository and
least-privilege credentials; do not expose those credentials to pull requests.

## 5. Cross-phase safeguards

- Keep repository API details behind an adapter and domain changes behind
  explicit operations.
- Validate the root object and the entire serialized document before every
  commit.
- Use deterministic JSON output and never place note values in commit messages,
  logs, analytics, errors, URLs, or test snapshots.
- Model failures as typed results so authentication, conflict, rate-limit,
  connectivity, corrupt-data, and validation errors lead to different recovery
  actions.
- Keep dialogs and pending editor state in memory during a session, and clear
  sensitive state on sign-out.
- Add schema/version fields to application-owned auxiliary data such as trash
  and operation metadata; `remember.json` remains ordinary JSON.
- Avoid premature optimization. Measure generated large trees on target phones
  before adding workers, virtualization, or a third-party search index.

## 6. Release milestones

The end of Phase 2 is an internal alpha: one device can safely perform basic
online edits. The end of Phase 4 is a private beta: the complete mutation set is
safe across multiple devices. The end of Phase 6 is the initial production
release, satisfying the design's acceptance scope including search, history,
restoration, export, installability, and upgrade behavior.

Do not call a milestone complete solely because its UI is present. Its exit
criteria, automated tests, security checks, and failure recovery must all pass.

## 7. Testing so far and next steps

### How to test progress so far

No application code exists yet, so there is nothing to run or test today.
Until Phase 0 lands, verification means reviewing the documents rather than
running anything:

- Re-read `docs/requirements.md` and `docs/design.md` together and confirm
  every requirement has a corresponding design section and phase above.
- Confirm `docs/questions.md`'s open items are actually resolved in
  `docs/design.md` section 15 ("Open questions"), which currently reads
  "None currently."
- Do not treat any GitHub integration claim in this plan as verified by
  reasoning or by reading GitHub's docs alone. Phase 0's exit criteria exist
  specifically because device flow, atomic multi-file commits, conflict
  detection, and CORS behavior from the deployed origin must be proven against
  a real disposable repository, not assumed.

Once Phase 0 code exists, the first real checks are: lint, type-check, unit
tests, a production build, and a CI smoke test, plus the four numbered spikes
in Phase 0 run manually against a disposable private repository, with
redacted request/response fixtures kept as evidence.

### Immediate next steps

1. Scaffold the Vite + TypeScript project and CI quality gates (Phase 0,
   first paragraph): lint, type-check, unit tests, build, and a minimal
   installable shell.
2. Register a GitHub App and create a disposable private repository to run
   the Phase 0 spikes against. **This requires your explicit approval before
   creating or configuring either one.**
3. Run and document the four Phase 0 spikes: device-flow authorization and
   refresh without a client secret or proxy; an atomic multi-file commit via
   the Git Data API; a rejected stale-writer commit distinguished from a
   network/authorization failure; and required API calls succeeding under
   CORS from the deployed Pages origin.
4. Only after all four spikes pass and Phase 0's other exit criteria are met,
   check off Phase 0 above, then proceed to Phase 1 (domain model and local
   tree browser) as the next planned phase.
