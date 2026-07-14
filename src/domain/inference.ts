import type { JsonValue, ValueKind } from "./types.ts";
import { kindOf } from "./types.ts";

export interface InferredValue {
  value: JsonValue;
  kind: ValueKind;
}

/**
 * Implements the value-input rules in design.md 6.2: input is parsed as
 * JSON when it is valid JSON (so `123`, `true`, `null`, `[1, 2]`, and a
 * quoted `"123"` become their JSON-typed values), and otherwise accepted
 * verbatim as a string (so `hello world` and JSON-looking-but-invalid text
 * such as `[hello` both become strings). This single rule reproduces every
 * row of the design's inference table, including that quoting forces a
 * string.
 */
export function inferValue(input: string): InferredValue {
  try {
    const value = JSON.parse(input) as JsonValue;
    return { value, kind: kindOf(value) };
  } catch {
    return { value: input, kind: "string" };
  }
}
