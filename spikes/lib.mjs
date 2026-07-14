// Shared helpers for the throwaway Phase 0 spike scripts (impl.md).
import { readFile } from "node:fs/promises";

export const REPO = process.env.SPIKE_REPO ?? "philhanna/notes-data";

export async function loadToken() {
  const tokenUrl = new URL("./.local/token.json", import.meta.url);
  const { access_token } = JSON.parse(await readFile(tokenUrl, "utf8"));
  return access_token;
}

export async function gh(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => undefined);
  return { status: response.status, ok: response.ok, body };
}
