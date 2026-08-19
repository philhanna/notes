import { afterEach, describe, expect, it } from "vitest";
import {
  clearToken,
  isAccessTokenExpired,
  isRefreshTokenExpired,
  loadToken,
  saveToken,
  subscribeToTokenChanges,
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

describe("subscribeToTokenChanges", () => {
  it("notifies with the current token on a matching storage event", () => {
    const calls: (Token | null)[] = [];
    const unsubscribe = subscribeToTokenChanges((t) => calls.push(t));

    saveToken(token());
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "notes/auth-token",
        storageArea: localStorage,
      }),
    );

    expect(calls).toEqual([token()]);
    unsubscribe();
  });

  it("ignores storage events for unrelated keys", () => {
    const calls: (Token | null)[] = [];
    const unsubscribe = subscribeToTokenChanges((t) => calls.push(t));

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "some-other-key",
        storageArea: localStorage,
      }),
    );

    expect(calls).toEqual([]);
    unsubscribe();
  });

  it("notifies with null for a key-less event, as fired by localStorage.clear()", () => {
    saveToken(token());
    const calls: (Token | null)[] = [];
    const unsubscribe = subscribeToTokenChanges((t) => calls.push(t));

    clearToken();
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: localStorage }),
    );

    expect(calls).toEqual([null]);
    unsubscribe();
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
