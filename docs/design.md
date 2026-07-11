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
- trash and recovery;
- Git-backed revision history;
- restoration of one level without restoring the whole tree; and
- export of the current tree as ordinary JSON.

The initial version is for one user. Sharing, multi-user permissions,
collaborative editing, offline access, binary attachments, and JSON import are
out of scope.

The example `remember.json` is approximately 1.2 KB, has 23 scalar leaves, and
has a maximum depth of three. This small working-memory shape is the primary
design target. The repository will always be smaller than 1 GB, but interactive
performance in a phone browser is the practical size constraint.

## 3. System architecture

The system has three parts: a static web app that runs in the browser, a
GitHub App that proves who the user is, and a private GitHub repository that
stores the data. The two unfamiliar pieces are explained in detail below.

### 3.1 Static PWA

"Static" means the web app is just a fixed bundle of files — HTML, CSS, and
JavaScript — generated once at build time and then served exactly as-is to
every visitor. There is no server-side program running on a computer
somewhere that generates a page per request, checks a database, or holds any
state. This is different from most "web apps" people are used to (like Gmail
or a bank site), which have a backend server doing work on every request.
Here, the browser downloads the files once and then does all the work itself,
talking directly to GitHub's API for data.

This matters because it removes an entire category of things to build and
secure: no server to host, patch, or pay for; no server-side database; no
server-side secret to leak. The tradeoff is that anything the app needs to do
— rendering the tree, validating input, calling GitHub — has to happen in the
user's browser using JavaScript.

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
  translating what the app wants to do ("save this document", "read this
  file's history") into the specific HTTP calls GitHub's API requires. This
  keeps the rest of the app's code from needing to know GitHub API details
  directly, which also makes it possible to test the app against a fake
  in-memory repository instead of the real GitHub API (see `docs/impl.md`).
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
hands the app a token scoped to exactly what the installation allows. Because
this is a browser-only app with no server, device flow matters specifically
because it does not require a **client secret** — a second, private
credential that would normally have to live somewhere safe, which a static,
publicly-downloadable bundle of JavaScript cannot provide (anyone could view
it in the browser's developer tools).

### 3.3 Private GitHub repository

The third part is an ordinary private Git repository you create on GitHub.
It stores the current JSON document and, because Git keeps every past
version of every commit, it automatically stores the full revision history
too — there is no separate history database to build or maintain.

GitHub Pages can host the static PWA. Its source and deployed JavaScript may be
public because they contain neither notes nor secret credentials. A private
source repository does not by itself make an ordinary GitHub Pages site private.
The notes remain private because the PWA retrieves them from a private repository
only after GitHub authorization.

The PWA is deployed as an ordinary publicly accessible GitHub Pages site; GitHub
Enterprise private Pages is not required. Opening the public site reveals only
the application shell and sign-in screen. It does not reveal repository names,
note content, trash, history, or access tokens.

There is no custom API or continuously running process. Tree operations execute
in the PWA, and persistence uses GitHub's APIs.

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

The current Git commit SHA identifies a document revision. Within a revision, a
JSON Pointer path identifies a level or value. The PWA does not store separate
database IDs.

## 6. User interface

### 6.1 Tree browser

The main screen contains:

- a breadcrumb for the current object or array;
- its immediate children;
- distinct presentation for objects, arrays, and scalars;
- controls to create a scalar, object, or array;
- full-text search; and
- actions for rename, move, copy, delete, and history.

Selecting a container drills into it. Selecting a scalar opens its value editor.
Breadcrumb segments navigate to ancestors. A wide-screen tree sidebar is an
optional enhancement; the mobile layout does not depend on it.

Destructive actions require confirmation. Delete moves content to trash rather
than immediately removing it from the active tree.

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

### 7.3 Delete, trash, and recovery

Delete removes an entry from the active tree and places its content and original
path in the tracked `.trash/trash.json` file within the same repository. Each
trash record contains a stable trash ID, deletion time, original JSON Pointer
path, value type, and complete deleted content. Deleting a container includes all
descendants in that one record.

The commit that performs a deletion updates `remember.json` and
`.trash/trash.json` together. Git therefore exposes either the state before the
deletion or the complete state after it, never an active-tree change without its
corresponding trash record.

Recovery restores the original path when available and removes the corresponding
trash record in the same commit. If its object key is now occupied, the user
chooses another key or destination. The user may permanently delete individual
trash records or empty all trash, matching the Ubuntu desktop interaction.

Empty Trash removes content from the current repository state and trash UI, but
it is not secure erasure: earlier Git commits may still contain the data. Truly
purging it would require destructive history rewriting and is out of scope.

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

Device flow needs the public GitHub App client ID but no client secret. The
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
- read `remember.json` and its revision SHA;
- commit a conditional replacement of the file;
- list commits affecting the data and trash files; and
- read an earlier file version for preview or restoration.

Tree mutations occur against a validated in-memory copy. Only a fully serialized
and validated result is sent to GitHub. A failed write leaves the previous commit
unchanged, so a move, copy, recursive delete, or restoration cannot become
partially visible.

Commit messages are concise and generated from the operation, for example:

- `Set /where-was-i`
- `Move /tips/bash/fc to /shell/bash/fc`
- `Delete /with-rating`
- `Restore /tips to revision abc1234`

No note values are included in commit messages.

### 9.1 Initial setup

The user creates the private GitHub repository before using the app. During
setup, the PWA asks for its owner and name, confirms that it is private, and
verifies read/write access. It then creates `remember.json` only when that file
does not already exist. The PWA never creates a repository or changes repository
visibility.

## 10. History and level restoration

Every successful user mutation creates one Git commit. Git history is retained
indefinitely while the repository exists. The history UI derives relevant
revisions by comparing the selected JSON Pointer path across commits.

Every object and array therefore has a logical revision timeline. The user can:

1. open history at the current level;
2. preview that container as it appeared in an earlier commit;
3. compare it with the current version; and
4. restore the earlier container at the same path.

Restoring a level replaces only that object or array and its descendants. It does
not restore the whole document or change ancestors and siblings. The restoration
is a new Git commit and does not erase later history, so it can itself be undone.
Restoration always replaces the selected level as a whole; the user cannot pick
individual differences from within the historical preview.

A scalar value also has path-based revision history and can be restored
individually. Rename and move detection may be approximate because Git stores
document versions rather than stable node identities; generated commit metadata
helps the UI follow those operations.

Ordinary JSON export contains only the active tree. It omits trash and history.
There is no import capability.

## 11. Search

Search provides an SQLite FTS5-like experience without SQLite. After loading the
active JSON document, the PWA walks the tree and builds an in-memory index over:

- object keys;
- string values;
- textual representations of numbers, booleans, and null; and
- breadcrumb paths.

Matching is case-insensitive. Search excludes trash and historical revisions.
Results show the matching key or excerpt and its breadcrumb and navigate to the
containing level. The index is rebuilt after loading or modifying the tree.

Search uses one plain-text query box. A result matches when its key, scalar
value, or breadcrumb path contains the query, case-insensitively. Multiple query
words do not introduce a special query language. Phrase, prefix, key-only,
value-only, and path-only modes are not supported.

## 12. Backup and durability

The private GitHub repository is both the authoritative store and the revision
history. No second automated storage system is used. Git commits provide strong
recovery from ordinary edits and deletions, and JSON export allows manual copies.

Export occurs only when the user explicitly requests it. The application does
not schedule exports, show periodic backup reminders, or automatically copy an
export elsewhere.

This is not an independent backup. Deleting the repository, losing the GitHub
account, or a GitHub service failure could affect both current data and history.
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
- recursive trash, recovery, and Empty Trash behavior;
- atomic updates of `remember.json` and `.trash/trash.json`;
- deterministic JSON formatting;
- conditional Git writes and conflicting device updates;
- safe retries after uncertain network responses;
- commit history and path-based revision discovery;
- isolated restoration of a scalar, object, or array;
- case-insensitive full-text search and result paths;
- GitHub device authorization and repository scoping;
- JSON export without trash or history;
- responsive Android and Ubuntu layouts; and
- PWA installation and upgrade behavior.

End-to-end tests use a private test repository from two browser sessions and
verify that changes become visible, commits remain valid, and stale writes do not
overwrite newer data.

## 15. Open questions

None currently. New implementation questions should be recorded here as they
are identified.
