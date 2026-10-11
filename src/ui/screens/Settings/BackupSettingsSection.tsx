import React from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { reportClientError } from "../../../app/utils/clientError";
import {
  createManagedBackup,
  getBackupHistory,
  getBackupStatus,
  relaunchAfterBackupRestore,
  restoreManagedBackup,
} from "../../../app/db/posRepository";

function formatWhen(value: number | string | null | undefined) {
  if (!value) {
    return "Never";
  }
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) {
    return "Unknown";
  }
  return new Date(ms).toLocaleString();
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupSettingsSection() {
  const [status, setStatus] = React.useState<any>(null);
  const [history, setHistory] = React.useState<any[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ id: string; label: string } | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const next = await getBackupStatus();
    setStatus(next);
    try {
      const hist = await getBackupHistory();
      setHistory(hist?.records || []);
    } catch {
      setHistory([]);
    }
  }, []);

  React.useEffect(() => {
    void refresh().catch((e) =>
      setMessage(reportClientError("settings.backup.status", e, "Could not load backup status")),
    );
  }, [refresh]);

  const onBackupNow = async () => {
    setBusy("create");
    setMessage(null);
    try {
      const result = await createManagedBackup();
      if (result?.ok === false && result?.reason === "insufficient-disk-space") {
        setMessage(result.message || "Not enough storage space to create a backup.");
      } else {
        setMessage("Backup complete");
      }
      await refresh();
    } catch (e: any) {
      setMessage(reportClientError("settings.backup.create-managed", e, "Could not create backup"));
    } finally {
      setBusy(null);
    }
  };

  const localHistory = history.filter((row) => !String(row.destination || "").startsWith("cloud"));

  const runRestore = async () => {
    if (!confirm) {
      return;
    }
    const current = confirm;
    setConfirm(null);
    setBusy("restore");
    setMessage(null);
    try {
      await restoreManagedBackup(current.id);
      setMessage("Restore completed. Restarting…");
      await relaunchAfterBackupRestore();
    } catch (e: any) {
      setMessage(
        reportClientError("settings.backup.restore-managed", e, "Could not restore backup"),
      );
      setBusy(null);
    }
  };

  return (
    <>
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }} data-settings-sec="backup">
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Backup
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
          {status?.message || "Loading backup status…"}
        </div>

        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", margin: "0 0 12px", lineHeight: 1.5 }}>
          Backups stay on this computer. This offline POS does not upload them.
        </p>

        <div
          style={{
            display: "grid",
            gap: 8,
            fontSize: 13,
            color: "var(--pos-tx-sub)",
            marginBottom: 16,
          }}
        >
          <div>Last local backup: {formatWhen(status?.lastLocalBackupAt)}</div>
          <div>Local storage: {formatBytes(Number(status?.localStorageBytes || 0))}</div>
          <div>Automatic backup: {status?.automaticBackup === false ? "OFF" : "ON"}</div>
          <div>Retention: {status?.retentionDays ?? 14} days</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            type="button"
            variant="primary"
            disabled={busy !== null}
            onClick={() => void onBackupNow()}
          >
            {busy === "create" ? "Creating…" : "Backup Now"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Hide Backup History" : "View Backup History"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background:
                message === "Backup complete" || message.startsWith("Restore completed")
                  ? "var(--pos-success-tint)"
                  : "var(--pos-danger-tint)",
              color:
                message === "Backup complete" || message.startsWith("Restore completed")
                  ? "var(--pos-success)"
                  : "var(--pos-danger)",
            }}
          >
            {message}
          </div>
        ) : null}
      </div>

      {showHistory ? (
        <div
          className="pos-card pos-card-p"
          style={{ marginBottom: 24 }}
          data-settings-sec="backup"
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--pos-muted,var(--pos-tx-muted))",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Backup History
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {localHistory.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--pos-tx-muted)" }}>
                No backup records yet.
              </div>
            ) : null}
            {localHistory.slice(0, 30).map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontSize: 13,
                  borderBottom: "1px solid var(--pos-border,var(--pos-line))",
                  paddingBottom: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    Local backup{row.status === "failed" ? " (failed)" : ""}
                  </div>
                  <div style={{ color: "var(--pos-tx-muted)" }}>{formatWhen(row.created_at)}</div>
                </div>
                {String(row.path_or_provider || "").endsWith(".rnbak") && row.status !== "failed" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      setConfirm({
                        id: row.id,
                        label: formatWhen(row.created_at),
                      })
                    }
                  >
                    Restore
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(confirm)}
        title="Restore Backup?"
        confirmLabel="Restore Backup"
        cancelLabel="Cancel"
        loading={busy === "restore"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runRestore()}
      >
        <p>
          This will replace the current restaurant database with the selected backup
          {confirm ? ` from ${confirm.label}` : ""}.
        </p>
        <p>
          A safety backup of your current data will be created first. The app will restart after
          restore.
        </p>
      </ConfirmModal>
    </>
  );
}
