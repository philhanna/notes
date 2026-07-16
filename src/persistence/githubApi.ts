import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { PersistError } from "./types.ts";

export interface GithubResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/** A single authenticated call to api.github.com, mapped to a typed PersistError on failure. */
export async function githubFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Result<GithubResponse, PersistError>> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    return err({ kind: "network" });
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return ok({ status: response.status, headers: response.headers, body });
  }
  return err(errorFromResponse(response));
}

function errorFromResponse(response: Response): PersistError {
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      const reset = response.headers.get("x-ratelimit-reset");
      return {
        kind: "rate-limit",
        resetAt: reset ? Number(reset) * 1000 : null,
      };
    }
    return { kind: "forbidden" };
  }
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 409 || response.status === 422) {
    return { kind: "conflict" };
  }
  if (response.status >= 500) return { kind: "unavailable" };
  return { kind: "network" };
}
