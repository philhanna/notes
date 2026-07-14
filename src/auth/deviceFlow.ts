import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { AUTH_RELAY_URL, GITHUB_CLIENT_ID } from "./config.ts";
import type { AuthError, DeviceAuthorization, Token } from "./types.ts";

export type ExchangeOutcome =
  | { status: "authorized"; token: Token }
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "error"; error: AuthError };

/** Requests a device/user code pair through the relay (design.md 3.4, 8). */
export async function requestDeviceCode(): Promise<
  Result<DeviceAuthorization, AuthError>
> {
  const result = await postToRelay("/device/code", {
    client_id: GITHUB_CLIENT_ID,
  });
  if (!result.ok) return result;
  const body = result.value;
  if (typeof body.device_code !== "string") {
    return err(errorFromBody(body));
  }
  return ok({
    deviceCode: body.device_code,
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    expiresIn: Number(body.expires_in),
    interval: Number(body.interval ?? 5),
  });
}

/** One poll attempt against the device code (design.md 8); callers space these by `interval`. */
export async function exchangeDeviceCode(
  deviceCode: string,
): Promise<ExchangeOutcome> {
  const result = await postToRelay("/oauth/token", {
    client_id: GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (!result.ok) return { status: "error", error: result.error };
  return outcomeFromTokenResponse(result.value);
}

/** Exchanges a refresh token for a new access token through the same relay route. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<Result<Token, AuthError>> {
  const result = await postToRelay("/oauth/token", {
    client_id: GITHUB_CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!result.ok) return result;
  const outcome = outcomeFromTokenResponse(result.value);
  if (outcome.status === "authorized") return ok(outcome.token);
  if (outcome.status === "error") return err(outcome.error);
  return err({ kind: "expired" });
}

function outcomeFromTokenResponse(
  body: Record<string, unknown>,
): ExchangeOutcome {
  if (typeof body.access_token === "string") {
    return { status: "authorized", token: tokenFromResponse(body) };
  }
  if (body.error === "authorization_pending") return { status: "pending" };
  if (body.error === "slow_down") {
    return { status: "slow_down", interval: Number(body.interval ?? 10) };
  }
  if (body.error === "expired_token" || body.error === "bad_refresh_token") {
    return { status: "error", error: { kind: "expired" } };
  }
  if (body.error === "access_denied") {
    return { status: "error", error: { kind: "denied" } };
  }
  return { status: "error", error: errorFromBody(body) };
}

function tokenFromResponse(body: Record<string, unknown>): Token {
  const now = Date.now();
  const expiresIn =
    typeof body.expires_in === "number" ? body.expires_in : undefined;
  const refreshExpiresIn =
    typeof body.refresh_token_expires_in === "number"
      ? body.refresh_token_expires_in
      : undefined;
  return {
    accessToken: String(body.access_token),
    accessTokenExpiresAt:
      expiresIn !== undefined ? now + expiresIn * 1000 : null,
    refreshToken:
      typeof body.refresh_token === "string" ? body.refresh_token : null,
    refreshTokenExpiresAt:
      refreshExpiresIn !== undefined ? now + refreshExpiresIn * 1000 : null,
  };
}

function errorFromBody(body: Record<string, unknown>): AuthError {
  return { kind: "unexpected", message: String(body.error ?? "unknown") };
}

async function postToRelay(
  path: string,
  params: Record<string, string>,
): Promise<Result<Record<string, unknown>, AuthError>> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_RELAY_URL}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
  } catch {
    return err({ kind: "network" });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({ kind: "unexpected", message: `HTTP ${response.status}` });
  }
  if (typeof body !== "object" || body === null) {
    return err({ kind: "unexpected", message: `HTTP ${response.status}` });
  }
  return ok(body as Record<string, unknown>);
}
