import type { Token } from "./types.ts";

const STORAGE_KEY = "notes/auth-token";
const EXPIRY_SKEW_MS = 60_000;

/** Reads the current device's stored authorization, if any (design.md 8). */
export function loadToken(): Token | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Token;
  } catch {
    return null;
  }
}

export function saveToken(token: Token): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(token));
}

/** Signing out removes local tokens (design.md 8); it does not touch repoConfig. */
export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAccessTokenExpired(token: Token, now = Date.now()): boolean {
  return (
    token.accessTokenExpiresAt !== null &&
    token.accessTokenExpiresAt - EXPIRY_SKEW_MS <= now
  );
}

export function isRefreshTokenExpired(token: Token, now = Date.now()): boolean {
  return (
    token.refreshTokenExpiresAt !== null && token.refreshTokenExpiresAt <= now
  );
}

/**
 * Notifies `callback` with the current token whenever another tab saves,
 * refreshes, or clears it, so a background tab's stale in-memory token
 * doesn't outlive the localStorage it was read from (design.md 8).
 */
export function subscribeToTokenChanges(
  callback: (token: Token | null) => void,
): () => void {
  function handleStorage(event: StorageEvent): void {
    if (event.storageArea !== localStorage) return;
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    callback(loadToken());
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
