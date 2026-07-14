import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth.ts";
import { loadToken, saveToken } from "./tokenStore.ts";
import type { Token } from "./types.ts";
import * as deviceFlow from "./deviceFlow.ts";

vi.mock("./deviceFlow.ts", () => ({
  requestDeviceCode: vi.fn(),
  exchangeDeviceCode: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

function token(overrides: Partial<Token> = {}): Token {
  return {
    accessToken: "gho_abc",
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useAuth", () => {
  it("starts signed-out with no stored token", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("signed-out");
  });

  it("starts signed-in when a token is already stored", () => {
    saveToken(token());
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("signed-in");
  });

  it("signs in through device flow and stores the resulting token", async () => {
    vi.mocked(deviceFlow.requestDeviceCode).mockResolvedValue({
      ok: true,
      value: {
        deviceCode: "dc",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      },
    });
    vi.mocked(deviceFlow.exchangeDeviceCode)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "authorized", token: token() });

    const { result } = renderHook(() => useAuth());

    act(() => result.current.signIn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("authorizing");
    expect(result.current.userCode).toBe("ABCD-1234");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.status).toBe("signed-in");
    expect(loadToken()).toEqual(token());
  });

  it("cancelSignIn stops polling and returns to signed-out", async () => {
    vi.mocked(deviceFlow.requestDeviceCode).mockResolvedValue({
      ok: true,
      value: {
        deviceCode: "dc",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      },
    });
    vi.mocked(deviceFlow.exchangeDeviceCode).mockResolvedValue({
      status: "pending",
    });

    const { result } = renderHook(() => useAuth());
    act(() => result.current.signIn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("authorizing");

    act(() => result.current.cancelSignIn());
    expect(result.current.status).toBe("signed-out");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(deviceFlow.exchangeDeviceCode).not.toHaveBeenCalled();
  });

  it("signOut clears the stored token", () => {
    saveToken(token());
    const { result } = renderHook(() => useAuth());
    act(() => result.current.signOut());
    expect(result.current.status).toBe("signed-out");
    expect(loadToken()).toBeNull();
  });

  it("getAccessToken returns the current token when not expired", async () => {
    saveToken(token());
    const { result } = renderHook(() => useAuth());
    const outcome = await result.current.getAccessToken();
    expect(outcome).toEqual({ ok: true, value: "gho_abc" });
  });

  it("getAccessToken refreshes an expired token and persists the refreshed one", async () => {
    saveToken(
      token({
        accessTokenExpiresAt: Date.now() - 1000,
        refreshToken: "ghr_def",
      }),
    );
    vi.mocked(deviceFlow.refreshAccessToken).mockResolvedValue({
      ok: true,
      value: token({ accessToken: "gho_new" }),
    });

    const { result } = renderHook(() => useAuth());
    const outcome = await result.current.getAccessToken();

    expect(outcome).toEqual({ ok: true, value: "gho_new" });
    expect(loadToken()?.accessToken).toBe("gho_new");
  });

  it("getAccessToken clears the token when the refresh token has expired", async () => {
    saveToken(
      token({
        accessTokenExpiresAt: Date.now() - 1000,
        refreshToken: "ghr_def",
        refreshTokenExpiresAt: Date.now() - 1000,
      }),
    );

    const { result } = renderHook(() => useAuth());
    const outcome = await result.current.getAccessToken();

    expect(outcome).toEqual({ ok: false, error: { kind: "expired" } });
    expect(loadToken()).toBeNull();
  });
});
