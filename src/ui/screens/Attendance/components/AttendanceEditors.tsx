import React from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { formatOvertimeInput, parseOvertimeHours } from "../../People/peopleUtils";

export function OvertimeEditor({
  open,
  employee,
  minutes,
  onClose,
  onSave,
}: {
  open: boolean;
  employee: string;
  minutes: number;
  onClose: () => void;
  onSave: (minutes: number) => void;
}) {
  const [value, setValue] = React.useState(formatOvertimeInput(minutes));

  React.useEffect(() => {
    if (open) {
      setValue(formatOvertimeInput(minutes));
    }
  }, [minutes, open]);

  const save = () => {
    onSave(parseOvertimeHours(value));
    onClose();
  };

  return (
    <Modal open={open} title="Overtime" onClose={onClose}>
      <div className="ui-form-stack">
        <p style={{ margin: 0, fontSize: 13, color: "var(--pos-tx-sub)" }}>{employee}</p>
        <label className="pos-label" htmlFor="attendance-ot-hours">
          Hours
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="attendance-ot-hours"
            type="number"
            min={0}
            step={0.5}
            className="pos-input"
            value={value}
            placeholder="0"
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
          />
          <span style={{ fontSize: 13, color: "var(--pos-tx-sub)", fontWeight: 600 }}>hours</span>
        </div>
        <div className="ui-form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function NoteEditor({
  open,
  employee,
  note,
  required,
  onClose,
  onSave,
}: {
  open: boolean;
  employee: string;
  note: string;
  required?: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [value, setValue] = React.useState(note);

  React.useEffect(() => {
    if (open) {
      setValue(note);
    }
  }, [note, open]);

  const save = () => {
    onSave(value);
    onClose();
  };

  return (
    <Modal open={open} title="Attendance Note" onClose={onClose}>
      <div className="ui-form-stack">
        <p style={{ margin: 0, fontSize: 13, color: "var(--pos-tx-sub)" }}>{employee}</p>
        <label className="pos-label" htmlFor="attendance-note">
          Note{required ? " (required for leave)" : ""}
        </label>
        <textarea
          id="attendance-note"
          className="pos-input"
          rows={3}
          value={value}
          placeholder={required ? "Reason for leave" : "Optional note"}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="ui-form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
