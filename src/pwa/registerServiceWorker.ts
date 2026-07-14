let waitingWorker: ServiceWorker | null = null;
let skipWaitingRequested = false;

/**
 * Registers the app-shell service worker and reports when an updated
 * version has finished installing and is waiting to take over. The worker
 * never activates itself while an older version is already controlling the
 * page (see public/sw.js) — activation only happens once the caller
 * confirms via activateWaitingServiceWorker (design.md 13's "safe refresh").
 */
export function registerServiceWorker(onUpdateAvailable?: () => void): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }

  function doRegister() {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .then((registration) => {
        function trackInstalling(worker: ServiceWorker) {
          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              waitingWorker = worker;
              onUpdateAvailable?.();
            }
          });
        }

        if (registration.installing) {
          trackInstalling(registration.installing);
        }
        registration.addEventListener("updatefound", () => {
          if (registration.installing) {
            trackInstalling(registration.installing);
          }
        });
      });
  }

  // This is called from a React effect, which runs after the initial
  // commit rather than synchronously during script evaluation — by then
  // the page's own "load" event may already have fired (especially with no
  // slow subresources to wait on), so a plain addEventListener("load", ...)
  // can silently never run. Register immediately when that's already true.
  if (document.readyState === "complete") {
    doRegister();
  } else {
    window.addEventListener("load", doRegister, { once: true });
  }

  // A "controllerchange" event also fires the first time any service
  // worker starts controlling a previously uncontrolled page (immediately
  // after its first-ever activation, via public/sw.js's clients.claim()) —
  // that's normal first-visit behavior, not an update, and must not reload.
  // Only reload when this page itself asked a waiting worker to activate.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !skipWaitingRequested) return;
    reloading = true;
    window.location.reload();
  });
}

/** Tells the waiting service worker to activate; reloads once it takes over. */
export function activateWaitingServiceWorker(): void {
  skipWaitingRequested = true;
  waitingWorker?.postMessage({ type: "SKIP_WAITING" });
}
