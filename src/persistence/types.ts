/**
 * Distinct, typed persistence failures (design.md "Reliability and
 * deployment", Phase 2 exit criteria: connectivity, rate-limit,
 * authorization, malformed-data, and write errors must be distinguishable).
 */
export type PersistError =
  | { kind: "network" }
  | { kind: "unavailable" }
  | { kind: "rate-limit"; resetAt: number | null }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "malformed" };
