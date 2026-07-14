import { useState } from "react";
import type { FormEvent } from "react";
import { inferValue } from "../domain/inference.ts";
import type { TreeError } from "../domain/tree.ts";
import type { Result } from "../domain/result.ts";
import type { JsonObject, JsonValue } from "../domain/types.ts";
import { describeTreeError } from "./errors.ts";

interface CreateEntryFormProps {
  isArray: boolean;
  onCreateEntry: (
    key: string,
    value: JsonValue,
  ) => Result<JsonObject, TreeError>;
  onCreateElement: (value: JsonValue) => Result<JsonObject, TreeError>;
}

/** Creates a new object entry or array element at the current level (design.md 7.1). */
export function CreateEntryForm({
  isArray,
  onCreateEntry,
  onCreateElement,
}: CreateEntryFormProps) {
  const [key, setKey] = useState("");
  const [valueText, setValueText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inferred = inferValue(valueText);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = isArray
      ? onCreateElement(inferred.value)
      : onCreateEntry(key, inferred.value);
    if (result.ok) {
      setKey("");
      setValueText("");
      setError(null);
    } else {
      setError(describeTreeError(result.error));
    }
  }

  const actionLabel = isArray ? "Add element" : "Add entry";

  return (
    <form className="create-entry-form" onSubmit={handleSubmit}>
      <h2>{actionLabel}</h2>
      {!isArray && (
        <>
          <label htmlFor="create-entry-key">Key</label>
          <input
            id="create-entry-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </>
      )}
      <label htmlFor="create-entry-value">Value</label>
      <textarea
        id="create-entry-value"
        rows={2}
        value={valueText}
        onChange={(event) => setValueText(event.target.value)}
      />
      <p className="value-editor__inferred">
        Will save as <strong>{inferred.kind}</strong>:{" "}
        <code>{JSON.stringify(inferred.value)}</code>
      </p>
      <button type="submit">{actionLabel}</button>
      {error && (
        <p className="child-row__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
