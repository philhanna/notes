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
pure functions returning a typed `Result`. `src/components/` has the local
tree browser (breadcrumbs, child list, create/edit/rename forms, array
move-up/move-down controls, and a confirmation dialog for type-changing
replacements). All Phase 1 exit criteria are met; see the testing notes in
section 7.

Phase 2 is complete. `src/auth/` implements GitHub App device flow through
the relay (`deviceFlow.ts`), per-device token storage (`tokenStore.ts`),
repository selection stored separately from credentials (`repoConfig.ts`),
and a `useAuth` hook orchestrating sign-in, sign-out, and (when needed)
silent refresh. `src/persistence/` defines a `Repository` port
(`checkRepository`, `ensureDocument`, `loadDocument`, `saveDocument`) with
a real GitHub adapter (`githubRepository.ts`, Contents API, conditional on
`sha`) and an in-memory fake (`inMemoryRepository.ts`) exercised by the
same contract tests (`repository.contract.test.ts`). `src/app/useDocument.ts`
now optionally takes a `Repository` and commits each successful domain
mutation through it before updating local state, so a failed save leaves
both the document and the caller's pending input unchanged; mutators are
`Promise`-returning uniformly, and mutation failures are tagged
`{source: "domain" | "persist"}` since `TreeError` and `PersistError`
share some `kind` values. `src/components/App.tsx` is now the top-level
state machine (signed-out → `SignIn.tsx`; signed-in with no stored
repository → `Setup.tsx`; otherwise load and show `TreeBrowser`).
`src/app/fixtures/sampleDocument.ts` (Phase 1's fixture document) is
deleted — Phase 1's component tests now build their own small inline
sample document instead, and the app itself always loads a real document.
The relay's source moved from `spikes/relay/` to the
top-level `relay/` (design.md section 2's layout) without changing its
deployed URL. All Phase 2 exit criteria are met; see the testing notes in
section 7, including two real findings not apparent from GitHub's docs.

Phase 3 is complete. `src/domain/tree.ts` adds `move`, `copy`, `deleteEntry`
(a permanent, recursive removal — there is no trash or recovery), and the
shared `removeEntry`/`insertAtDestination` primitives, with cycle prevention
for moving a container into itself or a descendant. `src/persistence/gitDataApi.ts`
wraps the Git Data API's blob/tree/commit/ref objects, and `githubRepository.ts`
builds every commit through it instead of the Contents API. `src/app/useDocument.ts`
adds `move`/`copy`/`deleteEntry`, each committing through the same
`Repository.save` as the Phase 1/2 mutators. `src/components/ChildRow.tsx` adds
Move to…/Copy to…/Delete controls (a JSON-Pointer destination field,
confirmation before a permanent delete). All Phase 3 exit criteria are met;
see the testing notes in section 7.

Phase 4 is complete. `src/domain/diff.ts` adds `changedPaths` (the minimal
set of paths where two document snapshots differ — object keys compared
individually so edits to different keys are disjoint; equal-length arrays
compared index by index; any other array difference conservatively reports
the whole array as changed) and `pathsOverlap`/`anyPathOverlaps`.
`src/app/concurrency.ts` adds `affectedPaths`, mapping each `Operation` kind
to the document paths it reads or writes. `src/app/useDocument.ts`'s three
separate commit helpers are replaced by one `asDocumentResult`: every mutator
now supplies a `recompute` function of `(document) => Result<...>` instead of
a precomputed result, so it can be reapplied against a freshly reloaded base.
On a stale `sha`, `asDocumentResult` reloads the latest revision, diffs it
against local state, and either reapplies the operation once against the
fresh base when the changed paths are disjoint from the operation's affected
paths (design.md 7.4), or — on overlap — refreshes local `document`/`sha` to
the latest revision and returns a new `MutationError` variant,
`{source: "conflict", documentChanged}`, so the pending input the caller
already holds survives and a plain re-submission now operates against
current data. `src/components/errors.ts` adds `describeConflictError`,
naming the changed locations (never their values).
`src/persistence/githubRepository.ts`'s `save` handles the case where the
final ref-update request's *response* is lost (not necessarily the write
itself): since the candidate commit's sha is already known locally before
that request is made, an uncertain outcome is resolved by re-reading the
branch head and comparing it directly against that candidate sha — landed,
never landed, or someone else's write landed first — rather than by
retrying blindly or embedding a client-generated operation ID in the commit
message (design.md 7.4 offers the ID as a fallback "if necessary"; the
direct sha comparison turned out to be sufficient and simpler). All of this
is covered by new unit/component tests using the in-memory repository fake
and a fetch mock that can throw mid-attempt to simulate a lost response;
see the testing notes in section 7. This phase added no new GitHub API
surface — it recombines primitives (conditional ref update, distinguishable
`conflict`/`network` errors) already proven live in Phase 0's spikes and
Phase 2's real device-flow pass, so it was not re-verified against a real
repository; see section 7 for what that means for confidence in this phase.

Phase 5 is complete. `src/domain/search.ts` adds `buildSearchIndex` (a flat,
pre-lowercased index of every object key, scalar value's textual form, and
node breadcrumb) and `search` (case-insensitive substring matching against
those three fields, per design.md 11 — including the fact that a match on an
ancestor's breadcrumb also surfaces its descendants, since a breadcrumb by
definition includes its whole ancestor chain). It only receives the active
`document`.
`src/app/exportDocument.ts` serializes only `document` (never credentials or
repository settings — there is no way to pass them in) with
the same deterministic formatting as every commit, named
`notes-export-<timestamp>.json`. `src/components/SearchView.tsx` and
`ExportButton.tsx` (a plain download, triggered only on click) are wired into
`App.tsx` alongside the existing tree view.

Phase 6 is **partially complete** — two of its four exit criteria are met,
two genuinely are not, so unlike every earlier phase it is **not** checked
off below; see the checkboxes at the end of this entry and section 7 for
exactly what remains.

Base-path bugs were fixed first: `vite.config.ts`'s `base: "/notes/"` was
never matched by `public/manifest.json` (`start_url`/`scope`), by
`public/sw.js`'s cached URL list, or by `registerServiceWorker.ts`'s
registration path — all three were root-absolute static files Vite's
build-time HTML rewriting never touches (confirmed by inspecting a real
`dist/index.html`, which *does* get rewritten). `public/sw.js` was rewritten
to derive its own base path from `self.location` rather than hardcode it, to
cache Vite's real hashed `assets/*` bundle (cache-first, safe since those
filenames are content-hashed and immutable) in addition to the shell
document/manifest/icon, and to stop calling `skipWaiting()`/`clients.claim()`
unconditionally on install. Instead, an updated worker now waits until the
page explicitly asks it to activate (`activateWaitingServiceWorker`, a
`{type:"SKIP_WAITING"}` postMessage), and `App.tsx` shows a small "An update
is available" banner with a Reload button wired to it — design.md 13's "safe
refresh" is now the user's own action rather than a silent takeover.
`src/app/draftStorage.ts`/`useDraft.ts` mirror `ValueEditor`'s and
`CreateEntryForm`'s typed text to `sessionStorage` (session-scoped, not
`localStorage`, per the cross-phase safeguard about pending editor state),
restoring it if the page reloads mid-edit and clearing it once the editor
genuinely closes (success or explicit cancel) — this is what actually
protects an in-progress edit across a safe-refresh or an accidental reload,
since a `"network"` `PersistError` alone already left component state
untouched. `src/app/useOnlineStatus.ts` adds a `navigator.onLine` banner in
`App.tsx` so connectivity loss is reported proactively rather than only on
the next failed save. `ConfirmDialog.tsx` is now a real modal: it traps
Tab/Shift+Tab focus, treats Escape as Cancel, and restores focus to whatever
triggered it. `TreeBrowser.tsx` moves focus to the
current level's heading after navigation, since `react-router-dom`
(a listed but, this session confirmed, never-imported dependency) provides
no router lifecycle to hook — it has been removed rather than left as dead
weight. `src/index.css` adds a `prefers-reduced-motion` guard, a `min-width`
alongside the existing touch-target `min-height`, and a skip-to-content
link. `index.html` adds a restrictive `Content-Security-Policy` `<meta>` tag
(GitHub Pages cannot set custom response headers, so this is the only option
available), its allowlist checked directly against every real outbound host
(`api.github.com`, the auth relay) rather than guessed. `ci.yml` adds an
`npm audit --audit-level=high` step; `deploy-pages.yml` adds a
`workflow_dispatch` `ref` input so a rollback is "re-dispatch this workflow
with the previous release's git tag" rather than a new mechanism. Per a
decision confirmed with the user this session, the Phase-0 auth relay
(`notes-auth-relay-spike.ph1204.workers.dev`) and the single maskable SVG
icon were deliberately left as-is rather than reworked — both already work,
and reworking either would trade a real, working thing for a cosmetic one.

Three real findings surfaced only by driving this against a real browser
(Playwright/Chromium), not by reasoning or by the equivalent jsdom-based
Vitest tests — the same lesson section 7 draws from Phase 0's CORS spike:

1. Moving `registerServiceWorker()` out of `main.tsx`'s top-level script
   (where it ran synchronously, before the page's own `load` event could
   possibly fire) and into a React effect inside `App.tsx` (needed so it
   could report update-availability back into component state) broke its
   `window.addEventListener("load", ...)` registration: effects run after
   the initial commit, by which point `load` had often already fired in a
   fast local environment, so the listener silently never ran and `sw.js`
   was never even requested. Confirmed by a Playwright run logging every
   network request and seeing no request for `sw.js` at all. Fixed by
   checking `document.readyState === "complete"` and registering
   immediately in that case.
2. The service worker's `controllerchange` listener reloaded the page
   unconditionally — but that event also fires the *first* time any worker
   starts controlling a previously uncontrolled page (via `clients.claim()`
   on its very first activation), not only on a genuine later update. This
   caused an unwanted reload on first visit that manifested as a real
   Playwright test's `page.evaluate` failing with "Execution context was
   destroyed, most likely because of a navigation" mid-test. Fixed by only
   reloading when the page itself had asked a waiting worker to activate
   (a `skipWaitingRequested` flag set solely by `activateWaitingServiceWorker`).
3. `ConfirmDialog`'s original focus-restore approach (capture the previously
   focused element, restore it in a `useEffect` cleanup) broke specifically
   under React StrictMode's development-only double-invocation of effects
   (mount → cleanup → remount, meant to surface missing-cleanup bugs): the
   phantom cleanup fired immediately after every open and stole focus back
   to the trigger before the user did anything. jsdom-based Vitest tests
   never exercised this because Testing Library's `render` doesn't wrap
   components in `StrictMode` the way `main.tsx`/`harness.tsx` do; only a
   real `npm run dev` browser run surfaced it. Fixed by moving the
   restoration into the explicit confirm/cancel handlers themselves rather
   than an unmount effect — arguably more correct anyway, since "the dialog
   closed" is a domain event here, not a React lifecycle detail.

A fourth, non-bug finding shaped both the fix and its test: a service
worker cannot intercept the requests made by the very page load that
registers it (that load's JS/CSS are already in flight before the worker
exists), so the shell's `assets/*` bundle is only actually cached starting
from a *second* online visit. This matches real repeat-visitor behavior; the
e2e offline tests prime the cache with one extra reload before going offline
to model that accurately, rather than expecting offline support to appear
after a single first-ever visit.

Testing added this phase: `@playwright/test` and `@axe-core/playwright`
(the repository had no committed real-browser test infrastructure before
this — earlier "Playwright" mentions in this file were one-off spike
scripts). `src/harness.tsx`/`harness.html` are a dev/test-only entry point
mounting the real `TreeBrowser`/`ChildRow`/`ConfirmDialog`
components against `createInMemoryRepository` (the same fake the
persistence contract tests already use) with a small fixture document —
extending the codebase's existing "test everything without live GitHub"
pattern to real-browser tests, since `App.tsx`'s auth gate otherwise makes
that UI unreachable without a live GitHub sign-in. It is never referenced by
`npm run build`/`index.html`, so it never ships in the deployed bundle
(confirmed: `dist/` after a real build contains no `harness.html`). Playwright's
config runs two independent servers/projects: `harness` (`vite dev`) for
keyboard-only navigation and entry creation, the `ConfirmDialog` focus
trap/Escape, and `@axe-core/playwright` scans (including with
`prefers-reduced-motion` emulated); `pwa` (`vite preview` over the real
`dist/` build, since `registerServiceWorker` only runs in a production
build) for an axe scan of the pre-auth `SignIn` screen and the two
service-worker/offline smoke tests described above. All 8 pass headless
locally (`npm run e2e`) and are now a CI step in `ci.yml`, after
`npx playwright install --with-deps chromium`. New Vitest coverage:
`ConfirmDialog.test.tsx` (autofocus, Escape, Tab trap, focus-restore) and
additions to `TreeBrowser.test.tsx` (focus-after-navigation, a draft's
sessionStorage write-through and mount-time restore, a draft cleared after a
successful create) — `npm test` now runs 305 tests (was 297).
`npm run lint`, `npm run format`, `npm run typecheck`, and `npm run build`
all pass; a `dist/` grep swept for token-like strings, the fixture note text,
and confirmed only the already-public client ID/relay URL are present.

This session had neither a real Android or Ubuntu device, live GitHub
credentials, nor (per this environment's own network restrictions) a way to
reach the deployed `*.workers.dev` relay directly — the same constraint
Phases 4 and 5 recorded. So, matching how those phases drew the line: this
phase implemented and automatically tested everything reachable from here
(a real headless-Chromium browser, not just jsdom, for the accessibility and
PWA-shell work), and leaves genuinely unverified, rather than silently
checked off:

- a real install-to-home-screen and a genuine two-version update-then-reload
  cycle on actual Android Chrome and Ubuntu Chromium (this session's e2e
  suite proves the mechanism's pieces individually — registration, caching,
  the non-first-load reload guard — but not a full real install/upgrade);
- the live two-real-browser-session GitHub acceptance test design.md 14
  calls for;
- enabling GitHub's repository-level secret scanning/push protection under
  Settings → Code security — a one-time account action outside of code, not
  something to flip without the user present; and
- [x] Phase 0 — Project foundation and risk spikes
- [x] Phase 1 — Domain model and local tree browser
- [x] Phase 2 — Authentication, setup, and basic persistence
- [x] Phase 3 — Complete tree operations
- [x] Phase 4 — Concurrency and resilient saving
- [x] Phase 5 — Search and export
- [ ] Phase 6 — PWA hardening, accessibility, and release (partial — see above)

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
- a small explicit state layer rather than a database-shaped client framework
  (built as plain `useState`-based view switching in `App.tsx`/`TreeBrowser.tsx`
  rather than a router — `react-router-dom` was tried, never actually wired
  up, and removed as dead weight in Phase 6);
- Vitest and Testing Library for unit and component tests;
- Playwright and `@axe-core/playwright` for browser, PWA, and accessibility
  tests (added in Phase 6, against a dev-only harness for the parts of the
  UI that otherwise require a live GitHub sign-in);
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
  domain/       JSON tree, paths, validation, mutations, search
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
2. The app can read the repository head and commit `remember.json` by
   creating a Git blob, a tree, and a commit, then conditionally advancing
   the branch ref. **Result: confirmed** against `philhanna/notes-data` —
   one commit created the file this way.
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

Use the Git Data API to build the commit directly (blob → tree → commit →
ref) for full control over the conditional write and commit metadata. Capture
request/response fixtures with credentials and note content removed. If any
spike fails, revise
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
configuration, not a credential. **Result:** the relay was already deployed
for real during Phase 0's closing spike 4 rerun, so Phase 2 only pointed
`src/auth/` at its existing URL and moved its source from `spikes/relay/`
to the top-level `relay/` without redeploying or changing the URL.

The setup flow should accept owner, repository, and branch; confirm that the
repository is private and writable; discover the repository's default branch;
and create `remember.json` only when it is absent. Persist non-secret repository
configuration separately from credentials.

Connect Phase 1 operations to GitHub. Each mutation should load against a known
head commit, produce and validate a complete new document, make one conditional
commit, and update local state only after success. Generate value-free commit
messages from structured operation metadata.

Two design assumptions above were invalidated by direct testing against a
real device-flow sign-in, in the same spirit as the Phase 0 CORS finding —
neither was apparent from GitHub's documentation alone:

1. "Handle refresh" assumed a device-flow token's `refresh_token` grant
   needs no client secret, matching the initial device-code exchange. It
   does not: GitHub's `refresh_token` grant for a GitHub App user token
   requires `client_secret`, which a static PWA and its secretless relay
   cannot hold without contradicting design.md 3.4's explicit "the relay
   holds no secret" invariant. Confirmed by calling the relay's
   `/oauth/token` route directly with `grant_type=refresh_token` and
   observing `incorrect_client_credentials` regardless of whether a
   (dummy) `client_secret` was included. **Resolution:** rather than give
   the relay a secret, "Expire user authorization tokens" was disabled on
   the GitHub App itself (a one-time dashboard change, not a code or design
   change). New tokens are now non-expiring and revocable via sign-out or
   GitHub settings, which `src/auth/tokenStore.ts` already handled as its
   "never expires" case (`accessTokenExpiresAt: null`) — so `useAuth.ts`'s
   refresh path exists for a token shape this app no longer issues, kept
   only in case token expiration is ever re-enabled.
2. GitHub's Contents API GET can briefly lag behind a PUT it just accepted:
   a real page reload immediately after a real save momentarily showed the
   pre-save document, confirmed correct (including the new key) by querying
   the same endpoint again about a minute later. This is a read-after-write
   propagation characteristic of the API, not a bug in `saveDocument` — the
   commit is real and immediate (`saveDocument` returns the new `sha` from
   the PUT response and the app updates local state from that response, not
   from a re-fetch), and only a reload within the same short window can
   observe it. Not a Phase 2 blocker; Phase 4 (concurrency and resilient
   saving) is the natural place to revisit reload timing if it proves
   user-visible in practice.

Exit criteria:

- [x] a new device can authorize, select the dedicated repository, and reopen it;
- [x] sign-out removes local authorization;
- [x] setup never overwrites an existing document or changes repository visibility;
- [x] all basic mutations create one valid commit each; and
- [x] connectivity, rate-limit, authorization, malformed-data, and write errors are
  distinct and preserve the user's unsaved input.

### Phase 3 — Complete tree operations

Implement copy, move, and recursive, permanent delete. Enforce cycle
prevention, destination validation, and no implicit overwrite. Deleting an
entry, including all descendants for a container, removes it from the active
tree in the same commit — there is no trash or recovery path.

Exit criteria:

- [x] all operations are atomic at the Git commit level;
- [x] recursive operations and cycle prevention have focused domain tests; and
- [x] end-to-end tests cover delete, move, copy, and destination conflicts.

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

- [x] two browser sessions cannot silently overwrite one another;
- [x] disjoint edits are reapplied successfully;
- [x] overlapping edits stop with recoverable local state; and
- [x] timeout-before-response and timeout-after-commit cases do not duplicate an
  operation.

### Phase 5 — Search and export

Build the in-memory search index after load and after each successful mutation.
Index keys, scalar text, and breadcrumbs. Confirm acceptable
interaction time using generated documents substantially larger than the
current sample before adding a search library.

Implement active-tree JSON export as a local download with deterministic
formatting. Ensure credentials and repository settings are excluded.

Exit criteria:

- [x] search is case-insensitive and returns correct breadcrumbs;
- [x] exported JSON exactly represents the active tree and parses successfully.

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

- [ ] install, startup, upgrade, and rollback paths are tested. **Partial:**
  startup and the update-prompt's individual mechanisms (registration,
  cache-first asset caching, the non-first-load reload guard) are covered by
  a real headless-Chromium e2e run; a genuine install-to-home-screen and a
  real two-version update-then-reload cycle on actual Android Chrome/Ubuntu
  Chromium, and an actual rollback dry run, are not — see the Phase 6
  narrative above;
- [x] offline mode shows the shell and a clear read/write-unavailable state without
  exposing previously loaded notes after a fresh launch. **Confirmed** by two
  Playwright/Chromium e2e tests against a real production build and service
  worker (`e2e/pwa.spec.ts`): the shell and offline banner render from cache
  when offline, and the signed-out screen never shows note content, offline
  or not — structurally guaranteed since no note content is ever cached;
- [ ] automated acceptance tests pass against a disposable private repository from
  two browser sessions. **Not done** — this session had no live GitHub
  credentials or reachable relay; and
- [x] the release checklist verifies token redaction, repository scoping, no note
  data in deployed assets or diagnostics, and successful JSON export.
  **Confirmed:** a fresh `dist/` grep found no tokens or note fixture text
  (only the already-public client ID and relay URL); `npm audit
  --audit-level=high` is now a CI step; repository scoping is unchanged since
  Phase 2's live-verified pass; JSON export correctness remains covered by
  `exportDocument.test.ts`/`ExportButton.test.tsx`.

## 4. Testing approach

Maintain a test pyramid aligned with the module boundaries:

- **Domain tests:** table-driven and property-based tests for paths, casing,
  serialization, inference, every mutation, and invariants.
- **Persistence contract tests:** run the same cases against the in-memory fake
  and a mocked GitHub transport; separately run a small live-repository suite.
- **Component tests:** navigation, forms, validation, confirmation, preserved
  input, focus behavior, and error presentation.
- **End-to-end tests:** authorization seams, setup, CRUD, conflict,
  uncertain writes, export, installation, and update.
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
- Avoid premature optimization. Measure generated large trees on target phones
  before adding workers, virtualization, or a third-party search index.
- Keep the auth relay (`docs/design.md` section 3.4) a stateless forwarder for
  exactly two endpoints. It must never gain a secret, a database, session
  state, or application logic; anything more defeats the reason it exists.

## 6. Release milestones

The end of Phase 2 is an internal alpha: one device can safely perform basic
online edits. The end of Phase 4 is a private beta: the complete mutation set is
safe across multiple devices. The end of Phase 6 is the initial production
release, satisfying the design's acceptance scope including search, export,
installability, and upgrade behavior.

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

Phase 2's `src/auth/` and `src/persistence/` have unit tests with `fetch`
mocked to the request/response shapes spikes 1–3 already proved: device
flow's request/poll/refresh outcomes (pending, slow_down, expired, denied),
token storage and expiry, `useAuth`'s sign-in/cancel/sign-out state
machine, `checkRepository`/`ensureDocument`/`loadDocument`/`saveDocument`
against every `PersistError` kind, and a shared contract suite
(`repository.contract.test.ts`) running the same cases against
`inMemoryRepository` and a mocked GitHub transport. `useDocument.ts`'s
tests cover both the persistence-free path and a repository-backed path
(successful commit advances `sha`; a stale `sha` reports a conflict and
leaves the document and commit log untouched). `npm test` now runs 138
tests; `npm run lint`, `npm run typecheck`, `npm run format`, and
`npm run build` all pass.

Beyond mocked tests, Phase 2 was verified against the real
`philhanna/notes-data` repository twice, per this document's own rule not
to trust GitHub integration claims from reasoning alone:

- **Non-interactive:** `spikes/05-phase2-live-check.ts` (run with
  `node --experimental-strip-types`) imports the real `src/auth/deviceFlow.ts`
  and `src/persistence/githubRepository.ts` — not a reimplementation —
  refreshes a token through the deployed relay, then drives
  `checkRepository`, `ensureDocument`/`loadDocument`, a conditional
  `saveDocument`, a deliberately stale-`sha` `saveDocument` (confirmed
  `conflict`), and a cleanup write. Redacted result in
  `spikes/fixtures/05-phase2-live-check.json`.
- **Interactive:** the app was driven with a real headless Chrome
  (Playwright) against `npm run dev`, including a real device-flow
  sign-in with a human approving the code on github.com, connecting to
  `philhanna/notes-data` through `Setup`, creating a real entry, and
  confirming the resulting commit was visible both in the running app and
  by querying the GitHub API directly. This pass is what surfaced both
  findings recorded under Phase 2 above (the `refresh_token` client-secret
  requirement, found when a follow-up cleanup call needed a refresh; and
  the read-after-write reload lag, found when an immediate `page.reload()`
  briefly showed the pre-save document). After disabling token expiration
  on the GitHub App, the flow was rerun clean end-to-end with a freshly
  issued non-expiring token. Disposable marker keys created during these
  runs were removed from `philhanna/notes-data` afterward.

A related fix surfaced independently: React 19 StrictMode double-invokes
effects in development, and `App.tsx`'s document-loading effect had no
guard against two overlapping `loadDocument` calls racing on `setState`
(only found by comparing successive Playwright runs' network logs, not by
the mocked component tests, since both mocked calls resolve identically
either order). Fixed with a `cancelled` flag in the effect's cleanup —
the standard pattern for this class of bug.

Phase 4's concurrency handling has unit and component test coverage —
`npm test` now runs 256 tests — but, unlike Phases 0 and 2, it was **not**
separately re-verified against the real `philhanna/notes-data` repository.
That is a deliberate, narrower claim than earlier phases make, not an
oversight: every new GitHub-facing behavior this phase relies on (a
conditional ref update rejecting a non-fast-forward push with a status
distinct from other failures) was already proven live in Phase 0's spike 3
and exercised again in Phase 2's real device-flow pass. What Phase 4 adds is
new *client-side* orchestration around those already-proven primitives —
reload-and-diff, reapply-once, and a post-hoc head comparison after a lost
response — none of which talks to GitHub in a way earlier phases didn't
already cover. `src/domain/diff.test.ts` and `src/app/concurrency.test.ts`
cover `changedPaths`/`pathsOverlap`/`affectedPaths` directly (identical
documents, an added/removed/changed key, nested objects, equal- and
unequal-length arrays, a type change, and every `Operation` kind's affected
paths). `src/app/useDocument.test.ts` drives `asDocumentResult` through
`createInMemoryRepository` with a real second write injected mid-test to
simulate a concurrent device: a stale `sha` with no actual underlying change
auto-heals and commits, a disjoint concurrent edit is silently reapplied and
both edits survive, and an overlapping concurrent edit on the same path
returns the new `"conflict"` `MutationError` with local state already
refreshed to the latest revision and no duplicate commit attempted.
`src/persistence/githubRepository.test.ts` adds a fetch mock that throws
after a PATCH either does or doesn't actually reach the fake Git graph, to
exercise the three uncertain-ref-update outcomes (landed with the response
lost, never landed, and raced against another write) without a real
network. If a two-real-browser-session race ever behaves differently from
this mocked model, that would be a finding in the same spirit as the
Phase 2 corrections above — not yet ruled out by direct testing the way
those were.

Phase 5's search and export are pure client-side code with no GitHub calls
at all, so there is nothing to verify live for them beyond the unit and
component tests already covering them (`domain/search.test.ts`,
`app/exportDocument.test.ts`, `components/SearchView.test.tsx`,
`components/ExportButton.test.tsx`). `npm run lint`, `npm run typecheck`,
`npm run format`, and `npm run build` all pass.

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
   data.~~ Done.
8. ~~Implement device-flow auth, repository setup, and basic persistence;
   wire the tree browser to real GitHub read/write.~~ Done. Disabled
   "Expire user authorization tokens" on the GitHub App after discovering
   the `refresh_token` grant needs a client secret the relay cannot hold
   (see Phase 2 above); verified live against `philhanna/notes-data` both
   non-interactively and through a real device-flow sign-in.
9. ~~Check off Phase 2.~~ Done — all exit criteria met. Next: Phase 3
   (complete tree operations) — move, copy, and recursive, permanent delete,
   built on the Git Data API (design.md 7.3, 9).
10. ~~Implement move, copy, and recursive, permanent delete on the Git Data
    API persistence layer; check off Phase 3.~~ Done — all exit criteria met.
11. ~~Implement the reload/diff/reapply-once conflict handling and the
    uncertain-ref-update head comparison; check off Phase 4.~~ Done — all
    exit criteria met, on the mocked-test basis described just above.
12. ~~Build the in-memory search index and query; implement active-tree JSON
    export; check off Phase 5.~~ Done — all exit criteria met.
13. ~~Fix the manifest/service-worker base-path bugs; add the safe-refresh
    update prompt, in-progress-edit (sessionStorage) preservation, offline
    detection, `ConfirmDialog` focus trap/Escape/restore, focus-after-
    navigation, reduced-motion/touch-target/skip-link CSS, a CSP `<meta>`
    tag, CI dependency scanning, and rollback support in the deploy
    workflow; add Playwright + axe real-browser tests via a dev-only
    harness.~~ Done, but Phase 6 is **not** checked off — two of its four
    exit criteria genuinely need a real Android/Ubuntu device and live
    GitHub credentials this session didn't have; see the Phase 6 narrative
    and exit criteria above for exactly what's left. Remaining before Phase
    6 (and the "initial production release" milestone, section 6) can be
    checked off:
    - a real install/upgrade/rollback pass on actual Android Chrome and
      Ubuntu Chromium (this session's e2e suite proves the underlying
      mechanisms individually; not a substitute for the real thing);
    - the live two-real-browser-session GitHub acceptance test (design.md 14);
    - enabling GitHub's repository-level secret scanning/push protection
      (Settings → Code security — a one-time account action, not code).
