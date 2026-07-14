// Caches only the static application shell. Never cache GitHub API
// responses, tokens, or note content — see docs/design.md section 3.1.
const SHELL_CACHE = "notes-shell-v2";

// Derived from this file's own URL rather than hardcoded, so it stays
// correct under whatever base path the app is deployed at (e.g. "/notes/"
// for a GitHub Pages project site).
const BASE_PATH = new URL(".", self.location).pathname;
const SHELL_URLS = [
  BASE_PATH,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}icon.svg`,
];
const ASSETS_PATH = `${BASE_PATH}assets/`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)),
  );
  // Deliberately no skipWaiting() here: an updated worker waits until the
  // page confirms via the SKIP_WAITING message below (registerServiceWorker.ts),
  // so an in-progress edit is never interrupted by a silent takeover.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  // Vite's built asset filenames are content-hashed and therefore
  // immutable, so caching them permanently on first fetch is safe and lets
  // a returning offline visit find the real bundle instead of just the
  // bare shell URLs above.
  if (url.pathname.startsWith(ASSETS_PATH)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith(BASE_PATH)) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(BASE_PATH).then((cached) => cached ?? fetch(request)),
      ),
    );
  }
});
