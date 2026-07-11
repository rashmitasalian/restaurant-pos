import React from "react";

type OneHandProps = {
  onAddItem?: () => void;
  onSendKOT?: () => void;
  onPay?: () => void;
  onCancel?: () => void;
};

export default function OneHandControls(_: OneHandProps) {
  return (
    <div style={{ padding: 12 }}>
      <div style={{ color: "#666", fontSize: 13 }}>
        Actions are available in the Billing panel. Use K/P/C/U shortcuts.
      </div>
    </div>
  );
}
