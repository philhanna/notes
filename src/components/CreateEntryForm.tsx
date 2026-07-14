import { useState } from "react";
import type { FormEvent } from "react";
import type { MutationError } from "../app/useDocument.ts";
import { inferValue } from "../domain/inference.ts";
import type { Result } from "../domain/result.ts";
import type { JsonObject, JsonValue } from "../domain/types.ts";
import { describeError } from "./errors.ts";

interface CreateEntryFormProps {
  isArray: boolean;
  onCreateEntry: (
    key: string,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  onCreateElement: (
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
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
  const [saving, setSaving] = useState(false);
  const inferred = inferValue(valueText);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = isArray
      ? await onCreateElement(inferred.value)
      : await onCreateEntry(key, inferred.value);
    setSaving(false);
    if (result.ok) {
      setKey("");
      setValueText("");
      setError(null);
    } else {
      setError(describeError(result.error));
    }
  }

  const actionLabel = isArray ? "Add element" : "Add entry";

  return (
    <form
      className="create-entry-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
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
      <button type="submit" disabled={saving}>
        {actionLabel}
      </button>
      {error && (
        <p className="child-row__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
