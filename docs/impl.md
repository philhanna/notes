# Notes app implementation plan

## 0. Current status

A prior TypeScript vertical slice was built and then intentionally deleted
(commit `3c93594`) so implementation could restart against this plan.

Phase 0 is complete. The Vite + React + TypeScript scaffold, quality gates
(lint, type-check, unit test, build), and minimal installable PWA shell exist
and pass. A disposable private repository (`philhanna/notes-data`) and a
GitHub App (device flow enabled, Contents: Read and write, installed only on
that repository) exist and were used to run spikes 1–3 successfully. Spike 4
found that device flow's two `github.com` endpoints do not support browser
CORS — see `docs/design.md` section 3.4 for the resolution (a minimal
stateless auth relay). The relay is now deployed for real (Cloudflare
Worker, `https://notes-auth-relay-spike.ph1204.workers.dev`), the app's
source repository (`philhanna/notes`) was made public per `docs/design.md`
section 3.3 (it contains no secrets or note data) and deployed to GitHub
Pages at `https://philhanna.github.io/notes/`, and spike 4 was rerun from
that real deployed origin against the real deployed relay — confirmed, see
`spikes/fixtures/04-cors.json`. A secret/dependency scan over the scaffold
found nothing to fix. All Phase 0 exit criteria are met.

Phase 1 is complete. `src/domain/` is pure TypeScript with no React or
GitHub dependency: `types.ts`/`keys.ts` define the JSON value model and
case-insensitive key comparison, `path.ts` handles JSON Pointer encoding
and decoding, `inference.ts` implements the value-input rules from
`docs/design.md` section 6.2, `serialize.ts` handles deterministic
serialization and validates the case-insensitive-uniqueness and non-empty
key invariants from section 5.2, and `tree.ts` implements the Phase 1
operations (navigate, list children, create an object entry or array
element, rename a key, update a value with confirmation for a
scalar/container or object/array boundary crossing, reorder an array) as
pure functions returning a typed `Result`. `src/app/useDocument.ts` is a
thin React hook applying those operations to local component state against
fixture data (`src/app/fixtures/sampleDocument.ts` — fictional placeholder
content, not real notes, since this repository is public per
`docs/design.md` section 3.3). `src/components/` has a first local tree
browser (breadcrumbs, child list, create/edit/rename forms, array
move-up/move-down controls, and a confirmation dialog for type-changing
replacements) with no GitHub or authentication wiring yet — that is Phase
2. All Phase 1 exit criteria are met; see the testing notes in section 7.

- [x] Phase 0 — Project foundation and risk spikes
- [x] Phase 1 — Domain model and local tree browser
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
- ESLint and Prettier for static checks;
- GitHub Actions and GitHub Pages for CI and deployment; and
- a minimal serverless function platform (for example, Cloudflare Workers) for
  the stateless auth relay in `docs/design.md` section 3.4 — nothing else runs
  there.

Use Web Crypto where cryptographic browser APIs are needed. Do not add a custom
backend, service worker data store, or client-side notes cache beyond the loaded
in-memory document and deliberately retained unsaved editor state. The auth
relay is the sole exception to "no backend," and it must stay a stateless
forwarder with no secret, no persistence, and no application logic.

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
relay/          stateless auth relay (deployed separately from the PWA;
                see docs/design.md section 3.4)
```

The domain layer must be pure TypeScript: an operation receives a document and
returns a new document or a typed error. The persistence layer must expose an
interface that can be backed by both an in-memory fake and GitHub. React
components should not call GitHub APIs or mutate JSON directly. The `auth`
module is the only part of `src/` aware that two of its calls go to the relay's
URL instead of directly to `github.com`; everything downstream of it just sees
a token.

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
   without a client secret. **Result: confirmed, with one correction.** Device
   flow itself needs no client secret, and direct browser calls to
   `api.github.com` work with no proxy. But the two `github.com` endpoints
   device flow depends on (`/login/device/code` and
   `/login/oauth/access_token`) do not send CORS headers, so a browser blocks
   reading their response from any origin other than `github.com` itself —
   confirmed both by inspecting response headers and by reproducing the
   failure in a real headless-browser `fetch()` call. A minimal stateless
   relay (no secret, no persistence, forwards the request body unchanged and
   adds a CORS header) resolves this; see `docs/design.md` section 3.4. Proven
   locally (relay running under `wrangler dev`, real device/user code returned
   to a foreign-origin browser call); not yet proven from an actual deployed
   Pages + relay origin (see item 4).
2. The app can read the repository head and atomically commit both
   `remember.json` and `.trash/trash.json` by creating Git blobs, a tree, and a
   commit, then conditionally advancing the branch ref. **Result: confirmed**
   against `philhanna/notes-data` — one commit created both files together.
3. A stale writer cannot advance that ref and can distinguish a conflict from a
   network or authorization failure. **Result: confirmed** — a second writer
   using the same base commit was rejected with `422 Update is not a fast
   forward`, distinct in status and body from a `401 Bad credentials` auth
   failure.
4. Required GitHub API calls, and the auth relay, work from the deployed Pages
   origin under browser CORS rules. **Result: confirmed** — rerun from
   `https://philhanna.github.io/notes/` in a real browser against the real
   deployed relay: the direct `github.com/login/device/code` call was still
   CORS-blocked as expected, the same call through the deployed relay
   returned `200 OK` with a real `device_code`/`user_code`, and a direct
   `api.github.com` call reached GitHub without a CORS error (a `401 Bad
   credentials` response, not a blocked request). See
   `spikes/fixtures/04-cors.json`.

Use the Git Data API for multi-file writes; the Contents API alone cannot make
the active document and trash update one atomic commit. Capture request/response
fixtures with credentials and note content removed. If any spike fails, revise
the relevant design assumption before building dependent features — spike 1
did fail in its original form, and `docs/design.md` section 3.4 is that
revision.

Exit criteria:

- [x] lint, type-check, unit test, build, and a smoke test run in CI;
- [x] the app installs locally as a PWA and shows no note data while signed out;
- [x] a documented spike demonstrates private-repository read and conditional,
  atomic write from the deployed origin, including the auth relay actually
  deployed (not just run locally); and
- [x] secrets and tokens are absent from source, build artifacts, URLs, and
  logs. **Confirmed:** `npm audit` reports 0 vulnerabilities; a pattern sweep
  of `src/`, `dist/`, `docs/`, `spikes/`, `.github/`, and local wrangler logs
  found no live credentials. The one live token
  (`spikes/.local/token.json`) is excluded from git by `*.local` in
  `.gitignore`; `.claude/settings.json` contains only a placeholder `dummy`
  bearer value and the app's public (non-secret) client ID.

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

- [x] every JSON value round-trips with deterministic formatting;
- [x] special keys and JSON Pointer escaping are tested;
- [x] duplicate keys differing only by case are rejected;
- [x] the tree browser and editor work at phone and desktop widths; and
- [x] domain tests cover success, invalid destination, replacement confirmation,
  and non-mutating failure paths.

### Phase 2 — Authentication, setup, and basic persistence

Implement GitHub authorization and repository setup. Keep tokens in per-device
browser storage, centralize authenticated requests, redact diagnostics, and
handle refresh, revocation, sign-out, and authorization expiry. Deploy the
`relay/` function from a real account (Phase 0 proved it locally only) and
point the auth module at its URL; the relay's own address is non-secret
configuration, not a credential.

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
- Keep the auth relay (`docs/design.md` section 3.4) a stateless forwarder for
  exactly two endpoints. It must never gain a secret, a database, session
  state, or application logic; anything more defeats the reason it exists.

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

The Vite + React + TypeScript scaffold exists and its quality gates pass:
`npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run build` all succeed, and `vite preview` serves the built shell,
manifest, icon, and service worker correctly. CI (`.github/workflows/ci.yml`)
runs the same checks on push and pull request.

Spikes 1–3 were run against a real disposable private repository
(`philhanna/notes-data`) with a real GitHub App (device flow enabled,
Contents: Read and write, installed only on that repository) and passed;
throwaway scripts and redacted result fixtures live under `spikes/` (git-
ignored: `spikes/.local/` holds the live token, never committed). Spike 4
found that device flow's two `github.com` endpoints reject cross-origin
browser calls (no CORS headers) — confirmed by both inspecting response
headers and reproducing the failure in a real headless-browser `fetch()` —
and that a minimal stateless relay fixes it. `docs/design.md` section 3.4
records this as the corrected design assumption. The relay is now deployed
(Cloudflare Worker, `https://notes-auth-relay-spike.ph1204.workers.dev`) and
the PWA shell is deployed to GitHub Pages (`https://philhanna.github.io/notes/`,
built by `.github/workflows/deploy-pages.yml`); spike 4 was rerun from that
real origin against the real relay and passed, redacted result in
`spikes/fixtures/04-cors.json`.

Do not treat any further GitHub integration claim in this plan as verified by
reasoning or by reading GitHub's docs alone — the CORS finding above is a
direct example of why: it was not apparent from documentation and only
surfaced by making the actual calls from a real browser.

Phase 1's domain layer (`src/domain/`) and app-state hook
(`src/app/useDocument.ts`) have unit and component tests: `npm test` runs
74 tests covering path/pointer round-tripping and escaping, value
inference (every row of `docs/design.md` section 6.2's table), document
serialization and validation (root-must-be-object, empty-key and
duplicate-key-by-case rejection, including nested), every Phase 1 tree
operation (success, invalid destination, replacement confirmation, and
that failures leave the document unchanged), the `useDocument` hook, and
`TreeBrowser` component interaction (navigation, entry creation, a
preserved-input validation error, rename, array reordering, and the
confirm/cancel replacement flow). `npm run lint`, `npm run typecheck`, and
`npm run build` all pass. The app was also manually driven in a real
headless Chrome against `npm run dev` at both a 390px phone width and a
1280px desktop width — screenshots confirmed breadcrumb navigation into
`club_ids`, the value editor's live type-inference display, the
confirmation dialog appearing when replacing a scalar with an object, and
the tree reflecting the replacement afterward, with no console errors
beyond two pre-existing unrelated 404s (`favicon.ico`, `icon.svg`) from
the Phase 0 PWA scaffold. The fixture data in
`src/app/fixtures/sampleDocument.ts` is fictional placeholder content, not
real notes — see `docs/design.md` section 3.3 on this repository being
public.

### Immediate next steps

1. ~~Scaffold the Vite + TypeScript project and CI quality gates.~~ Done.
2. ~~Register a GitHub App and create a disposable private repository.~~ Done
   (`philhanna/notes-data`; app installed on it only).
3. ~~Run and document spikes 1–3.~~ Done, passed.
4. ~~Deploy the auth relay for real and redeploy/host the PWA shell; rerun
   spike 4 from that real origin.~~ Done. Relay deployed to Cloudflare
   Workers; `philhanna/notes` (the app's source repository, not the data
   repository) made public per `docs/design.md` section 3.3 and deployed to
   GitHub Pages; spike 4 rerun from `https://philhanna.github.io/notes/`
   against the deployed relay and passed.
5. ~~Run a secret/dependency scan over the current scaffold.~~ Done: `npm
   audit` clean, no credentials found in source, build artifacts, or logs.
6. ~~Check off Phase 0.~~ Done — all exit criteria met.
7. ~~Build the domain model and a local tree browser against fixture
   data.~~ Done. Next: Phase 2 (authentication, setup, and basic
   persistence) — wire the local tree browser to real GitHub read/write
   through the auth relay and repository adapter, replacing the fixture
   document.
