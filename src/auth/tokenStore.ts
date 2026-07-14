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
