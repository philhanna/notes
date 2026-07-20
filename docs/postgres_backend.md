# Plan: replace GitHub with a hosted PostgreSQL backend

This is a planning document only. It does not change the current storage
format, auth flow, or application behavior. It is grounded in the source
tree as of this writing (`src/persistence/`, `src/auth/`, `relay/`) and in
`docs/design.md`, which currently states the opposite goal: "there is no
application server, SQLite database, or Google Drive storage" (design.md
§1) and treats that as a deliberate constraint, not an oversight (design.md
§3.1, §12). Replacing GitHub with Postgres reverses that constraint, so
this plan treats it as an architecture change, not a swapped dependency.

## 1. Why this is a bigger change than "swap the backend"

The app's static-PWA design (design.md §3.1) works because the browser can
call `api.github.com` directly over HTTPS and GitHub adds CORS headers that
allow it. A browser cannot do the equivalent for Postgres: there is no
`fetch()`-reachable, CORS-enabled endpoint that speaks the Postgres wire
protocol, and shipping raw database credentials into a public JavaScript
bundle to work around that is not an option. So "use Postgres" always
implies a second, mandatory piece of infrastructure — some HTTP API in
front of the database — even before any schema is designed. That
reintroduces the three things design.md §3.1 says the current design
avoids: a server-side database, a server-side secret (the database
credential), and a server to host, patch, and pay for. Section 3.4's "auth
relay" is the one existing precedent for adding a server, and it was kept
intentionally minimal (stateless, secretless, generic) specifically to
avoid this. A Postgres backend cannot be that thin: it has to authenticate
requests, enforce that a user can only read/write their own data, and
apply the conditional-write logic GitHub's Git Data API currently gives for
free (§9 below).

None of that is a reason not to do it — it's the reason to plan the API
layer explicitly rather than assuming Postgres is a same-shape replacement
for `api.github.com`.

## 2. Current state (what actually has to change)

- **The persistence port is already an interface**, not a GitHub-specific
  contract: `Repository` (`src/persistence/repository.ts:39-53`) declares
  `checkRepository`, `ensureDocument`, `loadDocument`, and `save`, and
  `save` is already conflict-aware — it takes a `baseSha` and returns
  `PersistError { kind: "conflict" }` on a stale write
  (`repository.ts:44-52`). `githubRepository.ts` is one implementation of
  that port; `inMemoryRepository.ts` is another, used only by tests. This
  is the main reason the migration is tractable: domain (`src/domain/`),
  app (`src/app/`), and most of components (`src/components/`) depend only
  on `Repository`, never on GitHub specifics, by explicit design
  (design.md §3.1's "GitHub repository adapter" bullet, §121 of this repo's
  README: "either half could be swapped out independently").
- **Optimistic concurrency today is Git's, not custom logic.**
  `githubRepository.ts` uses the branch head commit SHA as the revision
  token: `loadDocument` returns it (`githubRepository.ts:112`), `save`
  conditions the commit on it via `updateRef` (`githubRepository.ts:226-263`),
  and an ambiguous network response is resolved by re-reading the head and
  comparing it against the attempted commit
  (`githubRepository.ts:256-262`) — landed, never-landed, or someone else's
  write landed first. A Postgres adapter has to reproduce this three-way
  outcome itself; Postgres gives no equivalent for free.
- **Auth is GitHub-specific end to end.** `src/auth/deviceFlow.ts` drives
  GitHub's OAuth device flow through the relay (`postToRelay`,
  `deviceFlow.ts:104-132`); `src/auth/tokenStore.ts` persists the resulting
  GitHub access/refresh tokens; `src/auth/repoConfig.ts` stores which
  owner/repo the token is scoped to (the design.md §9.1 setup step). All of
  this is GitHub-account-specific: "your data" is defined by "the repo you
  installed the GitHub App on," not by an account the app itself manages.
- **`relay/worker.js` exists for exactly one narrow reason**: two
  `github.com` endpoints (not `api.github.com`) don't send CORS headers
  (design.md §3.4). It forwards those two calls unchanged and adds a CORS
  header; it holds no secret and no state (`relay/worker.js:1-4`). This
  problem is specific to those two GitHub endpoints — it says nothing about
  whether a *new* backend will have the same issue (§6 below).
- **Git commits are the only history/recovery mechanism** (design.md §10,
  §12): "no second automated storage, history, or restoration system is
  used." A Postgres table has no equivalent unless one is built
  deliberately (§5, §10 below).

## 3. Target architecture

Because a browser-reachable HTTP layer in front of Postgres is mandatory
(§1), the real decision is which layer, not whether one exists.

| Option | Shape | Assessment |
| --- | --- | --- |
| **A. Supabase** (managed Postgres + auto-generated REST API + built-in Auth, incl. a GitHub OAuth provider, + Row Level Security) | Browser calls Supabase's HTTPS API directly, same shape as today's `fetch("https://api.github.com/...")` calls | Closest match to the current architecture's spirit: no custom server code to run/patch, CORS is handled by the platform, auth and per-user isolation are built in. Recommended. |
| **B. Managed Postgres (Neon / RDS / Railway) + a hand-written API** (e.g. a Cloudflare Worker using `postgres.js`/`node-postgres`) | Custom code plays the role Supabase's generated API plays in A | More code to design, secure, and maintain (the exact server this project has avoided since inception); only worth it if Supabase's constraints (below) are a real blocker. |
| **C. Self-hosted Postgres + PostgREST** | Middle ground between A and B | Adds real ops burden (patching, backups, uptime) for a single-user app; not recommended. |

Recommendation: **Option A**. It is the only option that doesn't turn this
project into "an app with a backend to run," which was the thing design.md
§1/§3.1 opted out of from the start.

## 4. Data model (Option A)

```sql
create table documents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id),
  doc         jsonb not null,
  revision    bigint not null default 1,
  updated_at  timestamptz not null default now()
);

create unique index documents_owner_id_key on documents (owner_id);

alter table documents enable row level security;
create policy "owner can read/write own document"
  on documents for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

- `revision` replaces the Git commit SHA (`LoadedDocument.sha`,
  `repository.ts:29-32`) as the conditional-write token. A save becomes:

  ```sql
  update documents
     set doc = $1, revision = revision + 1, updated_at = now()
   where owner_id = $2 and revision = $3
  returning revision;
  ```

  Zero rows returned means the same thing `githubRepository.ts:262`'s
  `err({ kind: "conflict" })` means today: someone else's write landed
  first. This is a direct, mechanical translation of the existing
  `save(state, baseSha, operation)` contract (`repository.ts:48-52`) — no
  change to that interface is needed.
- Row Level Security (`owner_id = auth.uid()`) replaces "the GitHub App is
  installed only on your own private repo" (design.md §3.2) as the
  isolation mechanism. This is a meaningful behavior change worth calling
  out on its own: today isolation is enforced by the user's own GitHub
  account and repo choice; under Postgres it is enforced by this app's
  database policies. A bug in the policy is a cross-user data leak in a way
  the current design structurally cannot have.
- History/recovery (design.md §10) has no built-in equivalent. If it needs
  to be preserved, add:

  ```sql
  create table document_history (
    id          bigint generated always as identity primary key,
    owner_id    uuid not null,
    doc         jsonb not null,
    revision    bigint not null,
    recorded_at timestamptz not null default now()
  );
  ```

  populated by an `after update` trigger that inserts the *previous* row.
  If this is skipped, that is a real, documented regression from today's
  "every mutation is a recoverable Git commit" guarantee (design.md §7.3,
  §10) — it should be a decision, not an accident.

## 5. Auth

Supabase Auth's GitHub provider lets sign-in stay "Sign in with GitHub" —
same user-facing action — but the token that comes back authorizes calls
to *Supabase*, not `api.github.com`. GitHub becomes a pure identity
provider; it no longer has anything to do with where notes live. This
replaces `deviceFlow.ts` + `tokenStore.ts`'s GitHub-token handling with
Supabase's session handling (`supabase-js`'s client already manages
refresh), and removes `repoConfig.ts`'s owner/repo concept entirely —
there is no more "which repo did you point this at," because a signed-in
user has exactly one `documents` row via the unique index above.

Because Supabase's API sends CORS headers for browser origins by default,
the CORS problem that motivated `relay/` (design.md §3.4) does not
reappear here — that was a property of two specific `github.com` OAuth
endpoints, not a general rule about all APIs. `relay/` and the Cloudflare
Worker it deploys to can be retired once this is confirmed (§7 Phase 0).

## 6. Persistence adapter

Add `src/persistence/supabaseRepository.ts` implementing `Repository`
(`repository.ts:39-53`) exactly like `githubRepository.ts` does:

- `loadDocument` → `select doc, revision from documents where owner_id = auth.uid()`.
- `ensureDocument` → insert a `{}` row if none exists yet (replaces design.md
  §9.1's "create `remember.json` only when absent").
- `save` → the conditional `update` in §4, mapping zero-rows-updated to
  `PersistError { kind: "conflict" }`.
- `checkRepository` → has no real equivalent (there is no separate
  "repository" to check private/writable/default-branch on); likely
  removable from the port once GitHub is gone, or reduced to a trivial
  reachability check.

`inMemoryRepository.ts` and `repository.contract.test.ts` need no changes —
the contract tests already exercise the port-level behavior
(load/save/conflict) independent of which adapter backs it, so the same
suite should run unmodified against `supabaseRepository.ts`.

## 7. Migration phases

Following this project's own precedent of spiking risky assumptions before
building on them (docs/impl.md Phase 0, for GitHub's Git Data API and the
CORS relay):

- **Phase 0 — spike.** From a throwaway page, confirm from a real browser
  (not just docs) that: Supabase's REST/RLS calls succeed cross-origin with
  no relay; the revision-conditioned `update` correctly returns zero rows
  on a stale write; GitHub-as-Supabase-auth-provider round-trips a session.
  This is the step most likely to surprise, the same way the CORS
  requirement did the first time (design.md §3.4).
- **Phase 1 — adapter.** Build `supabaseRepository.ts` and the schema in
  §4; run `repository.contract.test.ts` against it.
- **Phase 2 — auth.** Replace `deviceFlow.ts`/`tokenStore.ts` with Supabase
  session handling; retire `relay/` once Phase 0 confirms it's unneeded.
- **Phase 3 — setup screen.** Remove the owner/repo prompt (design.md
  §9.1); first sign-in provisions the user's one row automatically.
- **Phase 4 — data migration.** One-time script: for each existing user,
  read their current `remember.json` via the existing GitHub adapter and
  insert it as their `documents` row. Decide whether to also backfill
  `document_history` from Git log, or accept that history starts fresh.
- **Phase 5 — decommission and docs.** Update design.md/README to describe
  the new architecture. GitHub Pages hosting is unrelated to this migration
  (it's static-file hosting, not data storage) and can stay as-is. The
  private notes GitHub repo and GitHub App can be decommissioned only after
  Phase 4's data is verified.

## 8. Tradeoffs

| Gained | Lost |
| --- | --- |
| Real queries/indexing instead of load-whole-document-reserialize-whole-document (design.md §5.4) | Git's free, automatic, per-commit history (design.md §10) — recoverable only if `document_history` (§4) is built and used |
| Room to grow past "one JSON blob" (multiple documents, richer schema) if ever wanted | GitHub's storage durability/backups "for free" as a side effect of being Git (design.md §12) — now this app owns that risk directly via its Supabase project |
| No more GitHub-specific setup step (§9.1) for new users | The "no server to run, patch, or pay for" property that has been true since design.md §1 — a Supabase project is a real piece of infrastructure this app now depends on being up and paid for |
| One backend serving all users the same way, no per-user "bring your own repo" step | Per-user data sovereignty — today each user's notes live in a repo *they* own and can inspect/export/delete outside the app; under Postgres, the app's database is the only copy unless the user exports |

## 9. Open questions

- Supabase vs. Option B/C (§3) is a real decision this plan doesn't make;
  it depends on how much the "no custom server code" property is worth
  keeping versus, e.g., avoiding a third-party platform dependency.
- Whether `document_history` (§4) is in scope for the first version, or a
  documented, accepted regression versus today's Git-backed recovery
  (design.md §10).
- Whether this app stays single-user-per-account (mirroring today: one
  document per identity) or whether moving off "one GitHub repo per user"
  is meant to also enable something GitHub couldn't, like sharing. Nothing
  in the current design.md scope (§2: "sharing... out of scope") asks for
  that, so absent a new requirement this plan assumes it stays out of
  scope here too.
- Whether both backends need to run in parallel for some transition
  period, or whether a single cutover (Phase 4 then immediate
  decommission) is acceptable.
