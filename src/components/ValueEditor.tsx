import { useEffect } from "react";
import type { FormEvent } from "react";
import { useDraft } from "../app/useDraft.ts";
import { clearDraft } from "../app/draftStorage.ts";
import { inferValue } from "../domain/inference.ts";
import type { JsonValue } from "../domain/types.ts";

interface ValueEditorProps {
  idPrefix: string;
  storageKey: string;
  initialText?: string;
  submitLabel: string;
  onSubmit: (value: JsonValue) => void;
  onCancel?: () => void;
}

/**
 * A plain-text value input that shows the inferred JSON type and value
 * before saving, per design.md 6.2. The typed text survives a safe-refresh
 * (docs/design.md 13) via useDraft, keyed by `storageKey`. The draft is
 * only cleared when this editor unmounts (submit succeeded or the user
 * cancelled) — a submit that comes back as a validation error or a pending
 * replacement confirmation leaves this component mounted, so the draft
 * (and the visible text) must survive that round-trip untouched.
 */
export function ValueEditor({
  idPrefix,
  storageKey,
  initialText = "",
  submitLabel,
  onSubmit,
  onCancel,
}: ValueEditorProps) {
  const fullKey = `value:${storageKey}`;
  const draft = useDraft(fullKey, initialText);
  const inferred = inferValue(draft.text);

  useEffect(() => {
    return () => clearDraft(fullKey);
  }, [fullKey]);

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
        value={draft.text}
        onChange={(event) => draft.setText(event.target.value)}
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
