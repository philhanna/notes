// Caches only the static application shell. Never cache GitHub API
// responses, tokens, or note content — see docs/design.md section 3.1.
const SHELL_CACHE = "notes-shell-v1";
const SHELL_URLS = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellRequest =
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    SHELL_URLS.includes(url.pathname);

  if (!isShellRequest) {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => cached ?? fetch(event.request)),
  );
});
