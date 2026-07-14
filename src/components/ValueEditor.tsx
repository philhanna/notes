import { useState } from "react";
import type { FormEvent } from "react";
import { inferValue } from "../domain/inference.ts";
import type { JsonValue } from "../domain/types.ts";

interface ValueEditorProps {
  idPrefix: string;
  initialText?: string;
  submitLabel: string;
  onSubmit: (value: JsonValue) => void;
  onCancel?: () => void;
}

/**
 * A plain-text value input that shows the inferred JSON type and value
 * before saving, per design.md 6.2.
 */
export function ValueEditor({
  idPrefix,
  initialText = "",
  submitLabel,
  onSubmit,
  onCancel,
}: ValueEditorProps) {
  const [text, setText] = useState(initialText);
  const inferred = inferValue(text);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(inferred.value);
  }

  const fieldId = `${idPrefix}-value`;

  return (
    <form className="value-editor" onSubmit={handleSubmit}>
      <label htmlFor={fieldId}>Value</label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
      />
      <p className="value-editor__inferred">
        Will save as <strong>{inferred.kind}</strong>:{" "}
        <code>{JSON.stringify(inferred.value)}</code>
      </p>
      <div className="value-editor__actions">
        <button type="submit">{submitLabel}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
