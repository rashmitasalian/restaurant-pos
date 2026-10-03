import React from "react";

type LicenseStatus = {
  status: "licensed" | "unlicensed";
  devBypass?: boolean;
  licenseId?: string;
  customerName?: string;
  plan?: "offline-perpetual";
  message?: string;
};

export function LicenseSettingsSection() {
  const [status, setStatus] = React.useState<LicenseStatus | null>(null);

  React.useEffect(() => {
    let alive = true;
    window.pos?.license
      ?.getStatus()
      .then((next) => {
        if (alive) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (alive) {
          setStatus({
            status: "unlicensed",
            message: "This license could not be verified.",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!status) {
    return (
      <div className="pos-card pos-card-p" data-settings-sec="license" id="settings-sec-license">
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          License
        </div>
      </div>
    );
  }

  const rows = status.devBypass
    ? [
        ["Status", "Development build"],
        ["Plan", "License not required"],
      ]
    : status?.status === "licensed"
      ? [
          ["Status", "Licensed"],
          ["License", status.licenseId || "—"],
          ["Plan", "Perpetual"],
          ["Restaurant", status.customerName || "—"],
        ]
      : [["Status", status.message || "This computer is not activated for RestoNiti."]];

  return (
    <div className="pos-card pos-card-p" data-settings-sec="license" id="settings-sec-license">
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "var(--pos-muted,var(--pos-tx-muted))",
          marginBottom: 16,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        License
      </div>
      <dl style={{ margin: 0, display: "grid", rowGap: 10 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
            <dt style={{ margin: 0, color: "var(--pos-tx-muted)" }}>{label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
