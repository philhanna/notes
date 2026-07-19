# Notes app design

## 1. Purpose

The notes app is a private, cloud-accessible working memory organized as a
hierarchical JSON value. It provides filesystem-style navigation and editing for
small facts, URLs, IDs, reminders, tips, and short gists.

The application is a Progressive Web App (PWA). The same static application runs
in a browser and can be installed on Android and Ubuntu. A private GitHub
repository is the only authoritative backing store; there is no application
server, SQLite database, or Google Drive storage.

## 2. Goals and scope

The application supports:

- access from Android, Ubuntu, and ordinary web browsers;
- objects, arrays, and JSON scalar values;
- filesystem-style browsing and tree operations;
- case-insensitive object keys;
- full-text search across the current tree;
- export of the current tree as ordinary JSON.

The initial version is for one user. Sharing, multi-user permissions,
collaborative editing, offline access, binary attachments, and JSON import are
out of scope.

The example `remember.json` is approximately 1.2 KB, has 23 scalar leaves, and
has a maximum depth of three. This small working-memory shape is the primary
design target. The repository will always be smaller than 1 GB, but interactive
performance in a phone browser is the practical size constraint.

## 3. System architecture

The system has three main parts: a static web app that runs in the browser, a
GitHub App that proves who the user is, and a private GitHub repository that
stores the data. The two unfamiliar pieces are explained in detail below.

It also has one small, stateless piece of infrastructure — an auth relay —
that exists only because of a browser restriction discovered during
implementation. Section 3.4 explains why it is necessary and why it does not
reintroduce the server-side risks (secrets, a database, ongoing hosting) that
the static-PWA design otherwise avoids.

### 3.1 Static PWA

"Static" means the web app is just a fixed bundle of files — HTML, CSS, and
JavaScript — generated once at build time and then served exactly as-is to
every visitor. There is no server-side program running on a computer
somewhere that generates a page per request, checks a database, or holds any
state. This is different from most "web apps" people are used to (like Gmail
or a bank site), which have a backend server doing work on every request.
Here, the browser downloads the files once and then does all the work itself,
talking directly to GitHub's API for data.

This matters because it removes most of the category of things to build and
secure: no server-side database, no server-side secret to leak, and — with
one narrow exception covered in section 3.4 — no server to host, patch, or
pay for. The tradeoff is that anything the app needs to do — rendering the
tree, validating input, calling GitHub — has to happen in the user's browser
using JavaScript.

"PWA" stands for Progressive Web App, explained fully in section 4; in short,
it is a website that a browser can also "install" so it behaves like a
regular app (its own icon, its own window, no address bar). The static PWA
bundle contains several distinct pieces of code, each solving a different
problem:

- **Responsive UI** — the visual layout (tree browser, editor screens,
  buttons) built so it rearranges itself to fit a small phone screen or a
  wide desktop window, rather than having separate phone and desktop
  versions.
- **Tree editor** — the part of the UI that lets the user browse into
  objects/arrays and create, edit, rename, move, or delete values, similar to
  a simple file manager but for JSON instead of files.
- **Search index** — a data structure built in memory, after the JSON
  document is loaded, that lets the app answer "which keys/values contain
  this text" instantly by scanning an in-memory structure instead of asking
  GitHub every time the user types a search character.
- **GitHub repository adapter** — a layer of code whose only job is
  translating what the app wants to do ("save this document", "load the
  latest document") into the specific HTTP calls GitHub's API requires. This
  keeps the rest of the app's code from needing to know GitHub API details
  directly, which also makes it possible to test the app against a fake
  in-memory repository instead of the real GitHub API (see `docs/impl.md`).
  All of these calls go to `api.github.com` directly from the browser; only
  the two device-flow calls described in section 3.4 go through the relay.
- **Install manifest** — a small JSON file (conventionally `manifest.json`)
  that tells the browser the app's name, icon, and colors, so "Install app"
  or "Add to Home screen" works and produces a proper-looking icon rather
  than a generic browser bookmark.
- **Service worker** — a special JavaScript file the browser runs in the
  background, separately from the page itself, that can intercept network
  requests before they leave the browser. It is what makes installed web
  apps able to start up instantly and, if configured to, work offline. In
  this design the service worker is deliberately limited to caching only the
  unchanging application shell (the HTML/CSS/JS files) — never GitHub API
  responses, tokens, or note content — so an attacker who gets access to a
  device's browser cache cannot recover notes from it (see section 13).

### 3.2 GitHub App

A **GitHub App** is a type of integration you register once with GitHub
(as a developer) that other GitHub accounts — here, just your own — can then
"install" onto specific repositories they choose. It is GitHub's recommended
way for a third-party program to access a user's repositories without ever
handling that user's actual GitHub password, and without being handed
blanket access to everything the user owns.

This is different from two simpler alternatives you may have used before:

- A **personal access token (PAT)** is a long-lived password-like string you
  generate manually in your own GitHub account settings and paste into a
  tool's configuration. It is tied directly to your account, is easy to
  over-scope (grant more access than needed) or forget about, and if it
  leaks, the leaker has whatever access it was granted for as long as it
  remains valid.
- An **OAuth App** (GitHub's older integration type) authenticates as a
  user but its permission model is coarser and it needs a client secret for
  some flows, which is awkward for an app with no server to keep that secret
  on.

A GitHub App instead has its own separate identity, declares in advance
exactly which permissions it will ever ask for (here, just repository
**Contents: Read and write** — nothing about issues, actions, admin
settings, or any other repository), and is explicitly installed by the user
onto **only select repositories** — in this design, just the one private
notes repository, not "all repositories" or every repo the user owns. Even
if the app's client ID became known to someone else, they could not use it
to access your other repositories, because the installation itself is what
grants repository access, and only you can create that installation.

"Authenticates the user" means proving, to GitHub's servers, that a request
is really coming from you and that you have approved this specific app
having this specific access — without the app ever seeing or storing your
GitHub password. The mechanism used here is the **OAuth device flow**
(detailed in section 8): the app shows a short code, you open a GitHub page
in any browser (including on another device) and enter it, and GitHub then
hands the app a token scoped to exactly what the installation allows. Device
flow matters specifically because it does not require a **client secret** — a
second, private credential that would normally have to live somewhere safe,
which a static, publicly-downloadable bundle of JavaScript cannot provide
(anyone could view it in the browser's developer tools). No secret is needed
either way; section 3.4 explains a separate, unrelated browser restriction
that device flow still runs into and how it is addressed without one.

### 3.3 Private GitHub repository

The third part is an ordinary private Git repository you create on GitHub.
It stores the current JSON document and, because Git keeps every past
version of every commit, retains earlier states without any application-level
history feature. Recovery is handled directly through Git when needed.

GitHub Pages can host the static PWA. Its source and deployed JavaScript may be
public because they contain neither notes nor secret credentials. A private
source repository does not by itself make an ordinary GitHub Pages site private.
The notes remain private because the PWA retrieves them from a private repository
only after GitHub authorization.

The PWA is deployed as an ordinary publicly accessible GitHub Pages site; GitHub
Enterprise private Pages is not required. Opening the public site reveals only
the application shell and sign-in screen. It does not reveal repository names,
note content, or access tokens.

There is no custom API and no continuously running application server. Tree
operations execute in the PWA, and persistence uses GitHub's APIs. Section 3.4
describes one narrow, stateless exception used only for two authentication
calls.

### 3.4 Auth relay

A browser blocks a webpage from reading the response of a cross-origin
`fetch()` call unless the server explicitly allows it (this is called CORS,
Cross-Origin Resource Sharing). GitHub's main API, `api.github.com`, allows
this from any origin, so the PWA calls it directly. However, the two
endpoints device flow itself depends on — requesting the short code
(`github.com/login/device/code`) and exchanging it for a token
(`github.com/login/oauth/access_token`) — do not allow this. This was not
apparent from reading GitHub's documentation; it was discovered empirically
during a Phase 0 spike (see `docs/impl.md`) by making the actual calls from a
real browser at a foreign origin and observing the request fail with a CORS
error, while the identical call from a non-browser context (where CORS does
not apply) succeeded.

Because of this, the PWA cannot complete device flow by calling those two
endpoints directly. Instead, it calls a minimal relay — a small serverless
function (for example, a Cloudflare Worker) — which forwards the request
body to the corresponding `github.com` endpoint unchanged and returns the
response with a CORS header added. Server-to-server calls are not subject to
CORS, so the relay itself can reach `github.com` without restriction.

The relay is deliberately as thin as possible, to preserve the spirit of the
static-PWA design even though it is, strictly, a small piece of server-side
infrastructure:

- it holds no client secret (device flow does not use one) and no other
  credential;
- it stores nothing and keeps no session state between requests — each
  request is forwarded independently;
- it never sees note content, since notes are never sent to these two
  endpoints; and
- it is generic infrastructure (a CORS-adding forwarder), not
  application-specific logic — the domain, persistence, and auth *decisions*
  described elsewhere in this document all still happen in the browser.

This is the one respect in which section 3's "no server" description is not
literally true. It is called out on its own here because it was a design
assumption invalidated by direct testing rather than a decision made in
advance, and future readers should not assume the rest of the architecture
needs a server merely because this one exception does.

## 4. Progressive Web App

A PWA is a web application that can be installed from a supporting browser. Once
installed, it has an icon on the Android home screen or Ubuntu application
launcher and opens in its own application window. The installed and browser
versions use the same code and GitHub data. Deployments update the application
without an app-store release.

The application requires an internet connection. It may cache static application
files for faster startup, but it does not cache the notes tree for offline use or
queue offline edits. If connectivity is lost during editing, the UI retains the
unsaved editor text, reports the problem, and waits for connectivity before
saving.

There are no special browser-version requirements. Development targets current
mainstream browsers on Android and Ubuntu. Browsers that do not support PWA
installation may still use the application as a website.

## 5. Data model

### 5.1 Node types

The document has one root object. Each entry is exactly one of:

- **object** — zero or more named children;
- **array** — zero or more ordered children; or
- **scalar** — a string, number, boolean, or null.

Objects and arrays are containers. A container has children and no scalar value;
a scalar has a value and no children. Containers may be nested in objects or
arrays, so every JSON structure can be represented.

### 5.2 Object keys

Object keys behave like names in a Windows directory: comparison is
case-insensitive, while the user's spelling is preserved for display and export.
For example, `Home` and `home` cannot coexist within the same object. A case-only
rename is allowed.

Empty keys are not allowed. The application otherwise imposes no domain-level
character or length restriction. Keys with spaces, punctuation, `/`, `~`, and
shell metacharacters are valid. Paths use JSON Pointer escaping, where `/`
becomes `~1` and `~` becomes `~0`.

### 5.3 Arrays

Arrays behave as ordered, navigable containers. Their elements are addressed by
zero-based position and may be scalars, objects, or arrays. Selecting a container
element drills into it just as selecting an object does.

New elements append to the end. Elements are reordered with drag-and-drop, with
an accessible move control for keyboard and screen-reader use. This is intended
in particular for ordered short gists such as a list of shell-script lines.

### 5.4 Repository representation

The active tree is stored as UTF-8 JSON in `remember.json`. Formatting is stable
and deterministic so commits contain meaningful content changes instead of
unrelated whitespace churn. Object key spelling and array order are preserved.

The complete active tree always remains in this one file. The application does
not split levels or top-level objects into separate files.

The current Git commit SHA identifies the state used for conditional saves.
Within that state, a JSON Pointer path identifies a level or value. The PWA
does not store separate database IDs.

## 6. User interface

### 6.1 Tree browser

The main screen contains:

- one continuous expandable tree rooted at `Notes`;
- compact, indented rows that keep visible ancestors in the tree;
- distinct presentation for objects, arrays, and scalars;
- independent expansion, selection, and keyboard focus;
- inline controls to create or edit a scalar, object, or array;
- full-text search; and
- actions for rename, move, copy, and delete.

Disclosure controls expand objects and arrays in place without changing
selection. Selecting a container targets child creation. Selecting a string
scalar opens a read-only rendered Markdown view of its value in the row's
panel; an explicit `Edit` action switches that panel to the raw-text editor.
Selecting a number, boolean, or null scalar leaves `Edit` as the direct
primary action, since there is nothing to render for those kinds. Multiple
branches may remain expanded at once. The tree uses the WAI-ARIA tree pattern
and roving keyboard focus. Arrow keys, Home, End, Enter, and Space operate on
the visible row sequence. The same tree is used on phones and desktop
browsers, with larger coarse-pointer targets and horizontal scrolling for
unusually deep paths.

Every string scalar's row preview and rendered view are Markdown: the closed
row shows a one-line, inline-only rendering (bold, italic, strikethrough,
inline code; links show their text but are not clickable; block constructs
flatten onto the line), while the row's panel shows full CommonMark
(headings, lists, blockquotes, code blocks, and real links restricted to
`http:`, `https:`, and `mailto:` targets). Raw HTML embedded in a string is
always treated as literal text, never executed. See `src/domain/markdown.ts`
for the parsing and sanitizing policy.

Expanded paths are remembered as device-local navigation metadata and validated
against each loaded document. Selection, focus, and inline editor state remain
in memory. Structural mutations reconcile path-keyed view state; when an array
index mapping cannot safely be retained, the affected array is collapsed.

Destructive actions require confirmation. Delete permanently removes content
from the active tree; there is no trash or recovery.

### 6.2 Value input

The editor accepts standard JSON and always permits string values without
surrounding quotes. The type inference rules include:

| Input | Stored value |
| --- | --- |
| `123` | number `123` |
| `true` or `false` | boolean |
| `null` | null |
| `[1, 2]` | array |
| `hello world` | string `"hello world"` |
| `"123"` | string `"123"` |

Any unquoted input that is not a valid non-string JSON value is accepted as a
string, including JSON-looking text such as `[hello`. The application escapes it
when serializing JSON; the user does not need to enter storage-level escaping.
Quoting forces a value such as `"true"` to remain a string rather than a boolean.
The editor displays the inferred type before saving.

Pasting a JSON object or array may create a navigable container. Keys do not need
quotes in ordinary forms; standard quoting applies to pasted JSON documents.

## 7. Operations

### 7.1 Create and update

Creating an object child requires its key and type or scalar value. Duplicate
keys in one object are rejected without regard to case. Creating an array element
appends it. Updating a scalar retains its path unless it is renamed or moved.

Replacing a scalar with a container, or changing between object and array,
requires explicit confirmation.

### 7.2 Rename, move, and copy

Rename changes an object entry's key. Array entries have positions rather than
keys. Move changes the parent and may supply a key when moving into an object. A
container cannot be moved into itself or one of its descendants.

Copy recursively duplicates a value or container. The destination is never
overwritten implicitly. Each complete rename, move, or copy is saved in one Git
commit.

### 7.3 Delete

Delete permanently removes an entry, and all its descendants for a container,
from the active tree in one commit. There is no trash and no recovery path in
the application; the deleted content simply no longer exists in the active
tree. As with any Git-backed change, earlier commits still contain the
predecessor state (section 9), but the application exposes no UI to browse or
restore a deleted entry from it.

### 7.4 Saving and simultaneous devices

The PWA reads `remember.json` together with its current Git blob or commit SHA.
Every write is conditional on that revision. If another device writes first,
GitHub rejects the stale replacement.

The application then reloads the latest tree and automatically reapplies the
pending operation when the affected paths do not overlap. If they overlap, it
preserves the user's unsaved edit and asks the user to retry. This avoids silently
replacing a newer whole document with stale content. No general merge editor or
collaborative locking is required.

After an uncertain network response, the PWA rereads the repository head before
retrying so it does not create a duplicate commit.

## 8. Authentication and security

Authentication uses a GitHub App with OAuth device flow. On first use on a phone
or desktop, the PWA displays a short code and opens GitHub's authorization page.
When the user is already signed into GitHub in that browser, GitHub reuses the
existing session; the user approves the app rather than entering credentials
again.

Device flow needs the public GitHub App client ID but no client secret. Because
the two `github.com` device-flow endpoints do not support cross-origin browser
requests, the PWA reaches them through the stateless auth relay described in
section 3.4, which holds no secret and forwards these two calls unchanged. All
other GitHub calls (reading and writing repository content)
go directly from the browser to `api.github.com`, which does support them. The
GitHub App is installed only on the dedicated private notes repository and is
granted the minimum repository Contents permission needed to read and write it.
It receives no access to unrelated repositories.

Each device stores its own revocable access and refresh tokens in browser storage.
Tokens are never placed in the repository, logs, URLs, or exports. Signing out
removes local tokens; GitHub settings can revoke the app or an individual grant.
The PWA retains authorization and silently refreshes tokens while the GitHub
grant remains valid. It does not impose periodic sign-in prompts. Authorization
is requested again only after explicit sign-out, revocation, cleared browser
storage, or an unrecoverable GitHub token expiration.

All traffic uses HTTPS. GitHub provides repository access control and its normal
encryption at rest. End-to-end encryption and user-managed encryption keys are
not required. GitHub can technically access the notes, so the application is not
a password manager and should not be used as one.

The deployed PWA contains no note data. Publishing it from a private repository
does not authorize it to read that repository; only the user's GitHub token does.

## 9. GitHub persistence

The PWA uses GitHub's APIs to:

- connect to the dedicated private repository created by the user;
- read `remember.json` and the current commit SHA; and
- commit a conditional replacement of the file.

Tree mutations occur against a validated in-memory copy. Only a fully serialized
and validated result is sent to GitHub. A failed write leaves the previous commit
unchanged, so a move, copy, or recursive delete cannot become partially visible.

Commit messages are concise and generated from the operation, for example:

- `Set /where-was-i`
- `Move /tips/bash/fc to /shell/bash/fc`
- `Delete /with-rating`

No note values are included in commit messages.

### 9.1 Initial setup

The user creates the private GitHub repository before using the app. During
setup, the PWA asks for its owner and name, confirms that it is private, and
verifies read/write access. It then creates `remember.json` only when that file
does not already exist. The PWA never creates a repository or changes repository
visibility.

## 10. Git-owned recovery

Every successful user mutation creates one Git commit, but the application does
not list, preview, compare, restore, undo, or otherwise expose earlier commits.
If recovery is needed, it is performed directly in the notes-data Git repository.

Ordinary JSON export contains only the active tree. There is no import capability.

## 11. Search

Search provides an SQLite FTS5-like experience without SQLite. After loading the
active JSON document, the PWA walks the tree and builds an in-memory index over:

- object keys;
- string values;
- textual representations of numbers, booleans, and null; and
- breadcrumb paths.

Matching is case-insensitive and covers only the active document.
Results show the matching key or excerpt and its breadcrumb. Selecting a result
returns to the tree, expands its complete ancestor chain, selects the exact
matching node, scrolls it into view, and moves keyboard focus to it. The index
is rebuilt after loading or modifying the tree.

Search uses one plain-text query box. A result matches when its key, scalar
value, or breadcrumb path contains the query, case-insensitively. Multiple query
words do not introduce a special query language. Phrase, prefix, key-only,
value-only, and path-only modes are not supported.

## 12. Backup and durability

The private GitHub repository is the authoritative store. No second automated
storage, history, or restoration system is used. Git itself provides recovery
when handled outside the app, and JSON export allows manual copies.

Export occurs only when the user explicitly requests it. The application does
not schedule exports, show periodic backup reminders, or automatically copy an
export elsewhere.

This is not an independent backup. Deleting the repository, losing the GitHub
account, or a GitHub service failure could affect both current and earlier data.
Independent automatic disaster backup is intentionally relaxed to honor the
single-storage-system constraint.

## 13. Reliability and deployment

All visible data changes correspond to complete Git commits. The PWA reports
connectivity, authorization, GitHub availability, rate-limit, and conflicting
revision errors without discarding the local edit.

Static PWA deployment uses automated builds and tests. A previous static artifact
can be redeployed if a release fails. The PWA detects a newly deployed client
version and requests a safe refresh without discarding an in-progress edit.

There is no application database migration, backend health check, or
content-bearing application log. Client diagnostics must exclude note content
and access tokens.

## 14. Testing and acceptance

Automated tests cover:

- parsing and round-tripping every JSON type;
- unquoted strings and internal escaping;
- case-insensitive, case-preserving key behavior;
- object and array navigation;
- array append and reordering;
- rename, move, copy, and cycle prevention;
- recursive, permanent delete;
- deterministic JSON formatting;
- conditional Git writes and conflicting device updates;
- safe retries after uncertain network responses;
- case-insensitive full-text search and result paths;
- GitHub device authorization and repository scoping;
- active-tree JSON export;
- responsive Android and Ubuntu layouts; and
- PWA installation and upgrade behavior.

End-to-end tests use a private test repository from two browser sessions and
verify that changes become visible, commits remain valid, and stale writes do not
overwrite newer data.

## 15. Open questions

None currently. New implementation questions should be recorded here as they
are identified.
