import { useState } from "react";
import type { FormEvent } from "react";
import type { MutationError } from "../app/useDocument.ts";
import { useDraft } from "../app/useDraft.ts";
import { inferValue } from "../domain/inference.ts";
import type { Result } from "../domain/result.ts";
import type { JsonObject, JsonValue } from "../domain/types.ts";
import { describeError } from "./errors.ts";

interface CreateEntryFormProps {
  isArray: boolean;
  storageKey: string;
  onCreateEntry: (
    key: string,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  onCreateElement: (
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  onCancel?: () => void;
}

/**
 * Creates a new object entry or array element at the current level
 * (design.md 7.1). The typed key/value survive a safe-refresh (design.md
 * 13) via useDraft, keyed by the current level's `storageKey`.
 */
export function CreateEntryForm({
  isArray,
  storageKey,
  onCreateEntry,
  onCreateElement,
  onCancel,
}: CreateEntryFormProps) {
  const key = useDraft(`create-key:${storageKey}`, "");
  const valueText = useDraft(`create-value:${storageKey}`, "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inferred = inferValue(valueText.text);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = isArray
      ? await onCreateElement(inferred.value)
      : await onCreateEntry(key.text, inferred.value);
    setSaving(false);
    if (result.ok) {
      key.clear();
      valueText.clear();
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
            value={key.text}
            onChange={(event) => key.setText(event.target.value)}
          />
        </>
      )}
      <label htmlFor="create-entry-value">Value</label>
      <textarea
        id="create-entry-value"
        rows={2}
        value={valueText.text}
        onChange={(event) => valueText.setText(event.target.value)}
      />
      <p className="value-editor__inferred">
        Will save as <strong>{inferred.kind}</strong>:{" "}
        <code>{JSON.stringify(inferred.value)}</code>
      </p>
      <button type="submit" disabled={saving}>
        {actionLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      )}
      {error && (
        <p className="child-row__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
