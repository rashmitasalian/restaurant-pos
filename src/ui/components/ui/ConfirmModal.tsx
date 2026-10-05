import React from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
  warning?: string | null;
  children?: React.ReactNode;
};

export function ConfirmModal({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  warning = "This action cannot be undone.",
  children,
}: Props) {
  return (
    <Modal
      open={open}
      front
      closeOnBackdrop
      title={title}
      onClose={() => {
        if (!loading) {
          onClose();
        }
      }}
    >
      <div className="ui-form-stack">
        {children ? <div className="ui-confirm-body">{children}</div> : null}
        {warning ? <p className="ui-confirm-warning">{warning}</p> : null}
        <div className="ui-form-actions">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={() => void onConfirm()} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
