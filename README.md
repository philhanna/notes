# Notes

A private, cloud-accessible working memory: a small filesystem-style tree of
notes, tips, IDs, and reminders, editable from a phone or a desktop browser.
There is no traditional server or database — the app runs entirely in your
browser and stores everything in a **private GitHub repository** you control.
See `docs/design.md` for the full design and `docs/impl.md` for the historical
implementation record.

The live app is deployed at **<https://philhanna.github.io/notes/>**.

---

## 1. Downloading and installing

There are two very different things "installing" can mean here — pick the
one you actually want:

### Option A — just use the app (no download needed)

Open **<https://philhanna.github.io/notes/>** in any modern browser and sign
in with GitHub. That's it — nothing to download or build. See section 2 for
how to also put an icon on your phone's home screen.

### Option B — get the source code (for development)

You only need this if you want to change the code, run it on your own
machine, or run its automated tests.

Prerequisites:

- **Git** — to download (`clone`) the source code.
- **Node.js** version 20 or newer, which includes **npm** (Node's package
  manager). Check what you have with `node --version` and `npm --version`.

Then, in a terminal:

```bash
git clone https://github.com/philhanna/notes.git
cd notes
npm install
```

`npm install` reads `package.json` (see section 3) and downloads every
library the app depends on into a `node_modules/` folder. This can take a
minute the first time; you only need to re-run it when `package.json`
changes.

---

## 2. Running the app

### a. From a bash CLI

From inside the `notes` folder (after `npm install`, per Option B above):

```bash
npm run dev
```

This starts a local development web server on your machine and prints a URL,
typically `http://localhost:5173/notes/`. Open that URL in a browser (see
2b). Leave the command running in the terminal — press `Ctrl+C` there to
stop it.

Other useful commands from the same folder:

```bash
npm run build      # produces an optimized, deployable copy in dist/
npm run preview    # serves that dist/ build locally, closer to production
npm test           # runs the automated unit/component tests
npm run e2e        # runs the automated real-browser (Playwright) tests
```

There is no separate command-line version of the app itself — it is a
browser application, so "running from bash" always means starting a local
web server (as above) and then opening it in a browser.

### b. From a web browser

Open either:

- the hosted app, **<https://philhanna.github.io/notes/>**, or
- your own local dev server's URL from `npm run dev` above.

Either way you'll see a sign-in screen. Click **Sign in with GitHub**, then
follow the on-screen device code: it opens a GitHub page (or gives you a URL
and a short code to enter) where you approve the app. Once approved, the app
loads your connected notes repository. The first time, it will ask you to
enter the owner/name of the private GitHub repository to use as storage
(see `docs/design.md` section 9.1) — this must be a private repository that
the "notes" GitHub App has been installed on.

### c. From an Android phone

1. Open Chrome and go to **<https://philhanna.github.io/notes/>**.
2. Sign in as in 2b.
3. Open Chrome's menu (⋮) and choose **Add to Home screen** / **Install
   app** (Chrome may also show this as a banner automatically).
4. An icon named "Notes" appears on your home screen. Opening it launches
   the app in its own window, without Chrome's address bar, like a native
   app.

This is a **Progressive Web App (PWA)** — installing it just bookmarks the
same website in a more app-like way; there's no app-store download. An
internet connection is required to sign in and to load/save notes; only the
app's own shell (not your notes) can be shown briefly while offline.

---

## 3. Architecture overview

If you're not familiar with **TypeScript**: it's the same language as
JavaScript (the language web browsers run), with an extra layer of type
checking added on top to catch mistakes before the code ever runs. Files
ending in `.ts` are plain TypeScript logic; files ending in `.tsx` are
TypeScript plus **React** — the library used to build the on-screen UI out
of reusable pieces called **components** (a component is just a function
that describes a piece of the page, e.g. "the sign-in screen" or "one row in
the note tree"). None of this code runs on a server; a build tool
(**Vite**) translates it all into plain JavaScript/CSS/HTML that a browser
can run directly.

### The big picture

```
Your browser  ──────────────►  api.github.com   (reads/writes your notes)
     │                                 ▲
     │ (only for the 2 sign-in calls   │
     │  that GitHub itself blocks      │
     ▼  from other websites)           │
  auth relay  ─────────────────────────┘
(tiny Cloudflare Worker, relay/)
```

The app talks directly to GitHub's API for everything except the very first
two steps of signing in, which get forwarded through a small helper program
(the "auth relay") because of a browser security rule GitHub's sign-in
pages don't support otherwise. The relay never sees your notes and holds no
password/secret — see `docs/design.md` section 3.4 for why it exists at all.

### Top-level layout

| Path                                                           | What it's for                                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/`                                                         | All of the application's own source code (see table below).                                                                                                                          |
| `public/`                                                      | Files copied as-is into the deployed app: the PWA install manifest, the icon, and the service worker script (see below).                                                             |
| `relay/`                                                       | Source for the tiny separate "auth relay" helper program (deployed independently to Cloudflare, not part of the main app).                                                           |
| `e2e/`                                                         | Automated tests that drive the app in a real browser (Playwright).                                                                                                                   |
| `docs/`                                                        | `design.md` (what the app does and why) and `impl.md` (the historical implementation record). Read these for the full story.                                                         |
| `.github/workflows/`                                           | Scripts GitHub runs automatically: one checks code quality on every change (`ci.yml`), the other deploys the app to `https://philhanna.github.io/notes/` (`deploy-pages.yml`).       |
| `index.html`                                                   | The single HTML page the app is loaded into — everything else is added to it by JavaScript.                                                                                          |
| `harness.html` / `src/harness.tsx`                             | A developer/test-only page used only by the automated browser tests, so they can exercise the note-editing screens without a real GitHub sign-in. Not part of the real deployed app. |
| `package.json`                                                 | The project's name, its list of dependencies (other people's code it uses), and the short commands listed in section 2a (`npm run dev`, etc.).                                       |
| `package-lock.json`                                            | An exact, auto-generated record of every dependency's precise version, so installs are reproducible. You should never need to hand-edit this.                                        |
| `tsconfig*.json`                                               | Settings for the TypeScript checker described above.                                                                                                                                 |
| `vite.config.ts` / `vitest.config.ts` / `playwright.config.ts` | Configuration for, respectively, the build tool, the unit-test runner, and the real-browser test runner.                                                                             |
| `eslint.config.js`                                             | Code-style rules, automatically checked by `npm run lint`.                                                                                                                           |
| `.gitignore`                                                   | Tells Git which files/folders (like `node_modules/` and build output) should never be tracked.                                                                                       |

### Inside `src/`

The code is deliberately split so that the "what a note tree can do" logic
never has to know anything about React or GitHub — that makes it fast and
simple to test, and means either half could be swapped out independently.

| Folder         | What it's for                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`      | The core rules, with no dependency on React or GitHub: what a note tree looks like, JSON parsing/formatting, path handling, and every edit operation (create, rename, move, copy, delete, reorder, search). Pure logic and data — nothing here draws anything on screen or talks to the network.              |
| `persistence/` | Everything about actually reading and writing GitHub: `repository.ts` defines _what_ operations are needed (load and save); `githubRepository.ts` is the real version that calls GitHub's API; `inMemoryRepository.ts` is a fake stand-in used by the automated tests so they don't need real network access. |
| `auth/`        | Signing in with GitHub (the "device flow" described in section 2b), and remembering your sign-in token and which repository you connected, in your browser's own storage.                                                                                                                                     |
| `app/`         | Glues `domain/` and `persistence/` together into the state the on-screen app actually uses — e.g. "here is the current note tree, and here are functions to rename/move/delete things that also save to GitHub and handle conflicts if two devices edit at once."                                             |
| `components/`  | The actual on-screen UI: the sign-in screen, the repository-setup screen, the tree browser and its edit/rename/move/delete controls, search, and export.                                                                                                                                                      |
| `pwa/`         | Registers the service worker (see below) and manages the "an update is available" prompt.                                                                                                                                                                                                                     |
| `test/`        | Small shared helpers used only by the automated tests (not part of the real app).                                                                                                                                                                                                                             |

Every `*.test.ts` / `*.test.tsx` file sits next to the file it tests and
contains automated checks for it — these run via `npm test` (fast, simulated
browser) or `npm run e2e` (slower, a real Chrome browser via Playwright),
and also run automatically in `.github/workflows/ci.yml` on every change.

### The PWA files in `public/`

- `manifest.json` — tells the browser the app's name, colors, and icon, so
  "Install app" (section 2c) works.
- `nature-herb.png` — the browser, home-screen, and installed-app icon.
- `sw.js` — the **service worker**: a small script the browser keeps
  running in the background that lets the app start up instantly and show
  its basic shell even with a flaky connection. It deliberately never
  caches your actual notes or your sign-in token — only the unchanging
  app shell — so nothing sensitive is ever left sitting in the browser's
  cache.
