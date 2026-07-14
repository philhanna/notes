export type AuthError =
  | { kind: "network" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "unexpected"; message: string };

/** A device's stored authorization (design.md 8). */
export interface Token {
  accessToken: string;
  /** Epoch ms, or null if this GitHub App issues non-expiring tokens. */
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}
