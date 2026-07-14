interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A minimal accessible confirmation prompt for destructive/type-changing actions. */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog" role="alertdialog" aria-modal="true">
      <p>{message}</p>
      <div className="confirm-dialog__actions">
        <button type="button" onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
