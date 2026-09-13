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

/**
 * The inverse of inferValue: the text to show when editing an existing
 * value, chosen so that inferValue(formatValueForEditing(v)) equals v. A
 * string is shown as its plain, unescaped text unless that text would be
 * inferred as something else (such as `123`, `true`, or `"quoted"`), in which
 * case it is shown quoted to keep it a string. Every other value is shown as
 * JSON.
 */
export function formatValueForEditing(value: JsonValue): string {
  if (typeof value === "string" && inferValue(value).value === value) {
    return value;
  }
  return JSON.stringify(value);
}
