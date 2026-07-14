/**
 * Non-secret GitHub App / relay configuration (design.md 3.2, 3.4). Device
 * flow needs no client secret, and the relay's own address is ordinary
 * configuration, not a credential, so both are committed here rather than
 * injected at build time.
 */
export const GITHUB_CLIENT_ID = "Iv23liBOOsS7SnBaH9d2";
export const AUTH_RELAY_URL =
  "https://notes-auth-relay-spike.ph1204.workers.dev";
