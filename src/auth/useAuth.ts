import { useCallback, useRef, useState } from "react";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import {
  exchangeDeviceCode,
  refreshAccessToken,
  requestDeviceCode,
} from "./deviceFlow.ts";
import {
  clearToken,
  isAccessTokenExpired,
  isRefreshTokenExpired,
  loadToken,
  saveToken,
} from "./tokenStore.ts";
import type { AuthError, Token } from "./types.ts";

export interface AuthState {
  status: "signed-out" | "authorizing" | "signed-in";
  userCode: string | null;
  verificationUri: string | null;
  signIn: () => void;
  cancelSignIn: () => void;
  signOut: () => void;
  /**
   * Referentially stable across renders (reads a ref, not `useState`
   * directly), so a `Repository` built once with this function keeps
   * seeing every later refresh instead of a stale token snapshot.
   */
  getAccessToken: () => Promise<Result<string, AuthError>>;
}

/**
 * Orchestrates device-flow sign-in, background token refresh, and sign-out
 * (design.md 8). Persistence code's only dependency on this module is
 * `getAccessToken`.
 */
export function useAuth(): AuthState {
  const [token, setTokenState] = useState<Token | null>(() => loadToken());
  const tokenRef = useRef(token);
  const [authorizing, setAuthorizing] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const cancelledRef = useRef(false);

  const setToken = useCallback((next: Token | null) => {
    tokenRef.current = next;
    setTokenState(next);
  }, []);

  const signIn = useCallback(() => {
    cancelledRef.current = false;
    setAuthorizing(null);
    void runDeviceFlow(cancelledRef, setAuthorizing, setToken);
  }, [setToken]);

  const cancelSignIn = useCallback(() => {
    cancelledRef.current = true;
    setAuthorizing(null);
  }, []);

  const signOut = useCallback(() => {
    cancelledRef.current = true;
    clearToken();
    setToken(null);
    setAuthorizing(null);
  }, [setToken]);

  const getAccessToken = useCallback(async (): Promise<
    Result<string, AuthError>
  > => {
    const current = tokenRef.current;
    if (!current) {
      return err({ kind: "unexpected", message: "not signed in" });
    }
    if (!isAccessTokenExpired(current)) return ok(current.accessToken);

    if (!current.refreshToken || isRefreshTokenExpired(current)) {
      clearToken();
      setToken(null);
      return err({ kind: "expired" });
    }

    const refreshed = await refreshAccessToken(current.refreshToken);
    if (!refreshed.ok) {
      if (refreshed.error.kind === "expired") {
        clearToken();
        setToken(null);
      }
      return refreshed;
    }
    saveToken(refreshed.value);
    setToken(refreshed.value);
    return ok(refreshed.value.accessToken);
  }, [setToken]);

  return {
    status: authorizing ? "authorizing" : token ? "signed-in" : "signed-out",
    userCode: authorizing?.userCode ?? null,
    verificationUri: authorizing?.verificationUri ?? null,
    signIn,
    cancelSignIn,
    signOut,
    getAccessToken,
  };
}

async function runDeviceFlow(
  cancelledRef: { current: boolean },
  setAuthorizing: (
    value: { userCode: string; verificationUri: string } | null,
  ) => void,
  setToken: (value: Token | null) => void,
): Promise<void> {
  const deviceResult = await requestDeviceCode();
  if (!deviceResult.ok || cancelledRef.current) {
    setAuthorizing(null);
    return;
  }
  const device = deviceResult.value;
  setAuthorizing({
    userCode: device.userCode,
    verificationUri: device.verificationUri,
  });

  let interval = device.interval;
  const deadline = Date.now() + device.expiresIn * 1000;
  while (!cancelledRef.current && Date.now() < deadline) {
    await sleep(interval * 1000);
    if (cancelledRef.current) return;

    const outcome = await exchangeDeviceCode(device.deviceCode);
    if (outcome.status === "authorized") {
      saveToken(outcome.token);
      setToken(outcome.token);
      setAuthorizing(null);
      return;
    }
    if (outcome.status === "slow_down") {
      interval = outcome.interval;
      continue;
    }
    if (outcome.status === "pending") continue;
    break;
  }
  setAuthorizing(null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
