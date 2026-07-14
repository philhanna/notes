import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeDeviceCode,
  refreshAccessToken,
  requestDeviceCode,
} from "./deviceFlow.ts";
import { AUTH_RELAY_URL } from "./config.ts";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestDeviceCode", () => {
  it("returns a device authorization on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${AUTH_RELAY_URL}/device/code`);
        return fakeResponse(200, {
          device_code: "dc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }),
    );

    const result = await requestDeviceCode();
    expect(result).toEqual({
      ok: true,
      value: {
        deviceCode: "dc",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      },
    });
  });

  it("reports a network error when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await requestDeviceCode();
    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });
});

describe("exchangeDeviceCode", () => {
  it("returns the authorized token, including refresh fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          access_token: "gho_abc",
          expires_in: 28800,
          refresh_token: "ghr_def",
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
        }),
      ),
    );

    const outcome = await exchangeDeviceCode("dc");
    expect(outcome.status).toBe("authorized");
    if (outcome.status !== "authorized") return;
    expect(outcome.token.accessToken).toBe("gho_abc");
    expect(outcome.token.refreshToken).toBe("ghr_def");
    expect(outcome.token.accessTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(outcome.token.refreshTokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it("treats a non-expiring token (no expires_in) as never expiring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, { access_token: "gho_abc" })),
    );

    const outcome = await exchangeDeviceCode("dc");
    expect(outcome.status).toBe("authorized");
    if (outcome.status !== "authorized") return;
    expect(outcome.token.accessTokenExpiresAt).toBeNull();
    expect(outcome.token.refreshToken).toBeNull();
  });

  it("reports pending while the user has not yet approved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, { error: "authorization_pending" })),
    );
    expect(await exchangeDeviceCode("dc")).toEqual({ status: "pending" });
  });

  it("reports slow_down with the new interval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, { error: "slow_down", interval: 12 }),
      ),
    );
    expect(await exchangeDeviceCode("dc")).toEqual({
      status: "slow_down",
      interval: 12,
    });
  });

  it("reports expired and denied as distinct terminal errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, { error: "expired_token" })),
    );
    expect(await exchangeDeviceCode("dc")).toEqual({
      status: "error",
      error: { kind: "expired" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, { error: "access_denied" })),
    );
    expect(await exchangeDeviceCode("dc")).toEqual({
      status: "error",
      error: { kind: "denied" },
    });
  });
});

describe("refreshAccessToken", () => {
  it("returns a refreshed token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${AUTH_RELAY_URL}/oauth/token`);
        const params = new URLSearchParams(init.body as string);
        expect(params.get("grant_type")).toBe("refresh_token");
        expect(params.get("refresh_token")).toBe("ghr_def");
        return fakeResponse(200, {
          access_token: "gho_new",
          expires_in: 28800,
          refresh_token: "ghr_new",
          refresh_token_expires_in: 15897600,
        });
      }),
    );

    const result = await refreshAccessToken("ghr_def");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.accessToken).toBe("gho_new");
  });

  it("reports expired when the refresh token is no longer valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, { error: "bad_refresh_token" })),
    );

    const result = await refreshAccessToken("ghr_def");
    expect(result).toEqual({ ok: false, error: { kind: "expired" } });
  });
});
