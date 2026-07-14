import { afterEach, describe, expect, it } from "vitest";
import {
  clearToken,
  isAccessTokenExpired,
  isRefreshTokenExpired,
  loadToken,
  saveToken,
} from "./tokenStore.ts";
import type { Token } from "./types.ts";

function token(overrides: Partial<Token> = {}): Token {
  return {
    accessToken: "gho_abc",
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("tokenStore", () => {
  it("round-trips a saved token", () => {
    expect(loadToken()).toBeNull();
    saveToken(token());
    expect(loadToken()).toEqual(token());
  });

  it("clears the stored token", () => {
    saveToken(token());
    clearToken();
    expect(loadToken()).toBeNull();
  });

  it("returns null for corrupt stored data instead of throwing", () => {
    localStorage.setItem("notes/auth-token", "{not json");
    expect(loadToken()).toBeNull();
  });
});

describe("isAccessTokenExpired", () => {
  it("is never expired when accessTokenExpiresAt is null", () => {
    expect(isAccessTokenExpired(token({ accessTokenExpiresAt: null }))).toBe(
      false,
    );
  });

  it("is expired once past the expiry minus the skew window", () => {
    const now = 1_000_000;
    expect(
      isAccessTokenExpired(token({ accessTokenExpiresAt: now + 30_000 }), now),
    ).toBe(true);
    expect(
      isAccessTokenExpired(token({ accessTokenExpiresAt: now + 120_000 }), now),
    ).toBe(false);
  });
});

describe("isRefreshTokenExpired", () => {
  it("is never expired when refreshTokenExpiresAt is null", () => {
    expect(isRefreshTokenExpired(token({ refreshTokenExpiresAt: null }))).toBe(
      false,
    );
  });

  it("is expired once past its expiry", () => {
    const now = 1_000_000;
    expect(
      isRefreshTokenExpired(token({ refreshTokenExpiresAt: now - 1 }), now),
    ).toBe(true);
    expect(
      isRefreshTokenExpired(token({ refreshTokenExpiresAt: now + 1 }), now),
    ).toBe(false);
  });
});
