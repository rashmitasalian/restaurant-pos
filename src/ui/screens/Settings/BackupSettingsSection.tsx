import React from "react";
import { AuthContext } from "../../context/AuthContext";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { Input } from "../../components/ui/Input";
import { reportClientError } from "../../../app/utils/clientError";
import {
  activateCloudBackup,
  createManagedBackup,
  exportRecoveryKeyFile,
  getBackupHistory,
  getBackupStatus,
  listCloudBackups,
  recoverCloudBackup,
  relaunchAfterBackupRestore,
  restoreCloudBackup,
  restoreManagedBackup,
} from "../../../app/db/posRepository";

function formatWhen(value: number | string | null | undefined) {
  if (!value) return "Never";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return "Unknown";
  return new Date(ms).toLocaleString();
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupSettingsSection() {
  const auth = React.useContext(AuthContext);
  const isAdmin = auth?.session?.role === "admin";
  const [status, setStatus] = React.useState<any>(null);
  const [history, setHistory] = React.useState<any[]>([]);
  const [cloudItems, setCloudItems] = React.useState<any[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = React.useState<string | null>(null);
  const [restaurantCodeInput, setRestaurantCodeInput] = React.useState("");
  const [recoveryKeyInput, setRecoveryKeyInput] = React.useState("");
  const [confirm, setConfirm] = React.useState<
    | { kind: "restore-local"; id: string; label: string }
    | { kind: "restore-cloud"; id: string; label: string }
    | null
  >(null);
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
    if (next?.cloudEnabled) {
      try {
        const cloud = await listCloudBackups();
        setCloudItems(cloud?.items || []);
      } catch {
        setCloudItems([]);
      }
    } else {
      setCloudItems([]);
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
      } else if (result?.cloudUpload && result.cloudUpload.ok === false) {
        setMessage(
          reportClientError(
            "settings.backup.cloud-upload",
            new Error(String(result.cloudUpload.reason || "upload-failed")),
            "Local backup created, but cloud upload failed.",
          ),
        );
      } else if (result?.cloudUploadPending) {
        setMessage("Local backup created. Cloud backup pending.");
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

  const onEnableCloud = async () => {
    if (!isAdmin) {
      setMessage("Only an admin can enable cloud backup.");
      return;
    }
    setBusy("activate");
    setMessage(null);
    try {
      const result = await activateCloudBackup();
      setRecoveryKey(result.recoveryKey);
      setMessage("Cloud backup enabled. Save your recovery key.");
      await refresh();
    } catch (e: any) {
      setMessage(reportClientError("settings.backup.activate", e, "Could not enable cloud backup"));
    } finally {
      setBusy(null);
    }
  };

  const onRecoverCloud = async () => {
    if (!isAdmin) {
      setMessage("Only an admin can restore from cloud on a new computer.");
      return;
    }
    setBusy("recover");
    setMessage(null);
    try {
      await recoverCloudBackup({
        restaurantCode: restaurantCodeInput,
        recoveryKey: recoveryKeyInput,
      });
      setMessage("Restaurant recovered. You can now restore a cloud backup.");
      setRecoveryKeyInput("");
      await refresh();
    } catch (e: any) {
      setMessage(reportClientError("settings.backup.recover", e, "Could not recover restaurant"));
    } finally {
      setBusy(null);
    }
  };

  const runRestore = async () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    setBusy("restore");
    setMessage(null);
    try {
      if (current.kind === "restore-local") {
        await restoreManagedBackup(current.id);
      } else {
        await restoreCloudBackup(current.id);
      }
      setMessage("Restore completed. Restarting…");
      await relaunchAfterBackupRestore();
    } catch (e: any) {
      setMessage(reportClientError("settings.backup.restore-managed", e, "Could not restore backup"));
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

        <div style={{ display: "grid", gap: 8, fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 16 }}>
          <div>Last cloud backup: {formatWhen(status?.lastCloudBackupAt)}</div>
          <div>Last local backup: {formatWhen(status?.lastLocalBackupAt)}</div>
          <div>Cloud backups: {status?.cloudEnabled ? cloudItems.length : 0} available</div>
          <div>Local storage: {formatBytes(Number(status?.localStorageBytes || 0))}</div>
          <div>Automatic backup: {status?.automaticBackup === false ? "OFF" : "ON"}</div>
          <div>Retention: {status?.retentionDays ?? 14} days</div>
          {status?.restaurantCode ? <div>Restaurant code: {status.restaurantCode}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button type="button" variant="primary" disabled={busy !== null} onClick={() => void onBackupNow()}>
            {busy === "create" ? "Creating…" : "Backup Now"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide Backup History" : "View Backup History"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void refresh()}>
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
                /fail|could not|error|not enough/i.test(message)
                  ? "var(--pos-danger-tint)"
                  : "var(--pos-success-tint)",
              color:
                /fail|could not|error|not enough/i.test(message) ? "var(--pos-danger)" : "var(--pos-success)",
            }}
          >
            {message}
          </div>
        ) : null}
      </div>

      {!status?.cloudEnabled ? (
        <div className="pos-card pos-card-p" style={{ marginBottom: 24 }} data-settings-sec="backup">
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
            Cloud Backup
          </div>
          <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginTop: 0 }}>
            Protect your restaurant data with automatic encrypted cloud backups when an internet connection is
            available.
          </p>
          {isAdmin ? (
            <Button type="button" variant="primary" disabled={busy !== null} onClick={() => void onEnableCloud()}>
              {busy === "activate" ? "Enabling…" : "Enable Cloud Backup"}
            </Button>
          ) : (
            <div style={{ fontSize: 13, color: "var(--pos-tx-muted)" }}>Ask an admin to enable cloud backup.</div>
          )}
        </div>
      ) : null}

      {isAdmin && !status?.cloudEnabled ? (
        <div className="pos-card pos-card-p" style={{ marginBottom: 24 }} data-settings-sec="backup">
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
            Restore from Cloud
          </div>
          <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginTop: 0 }}>
            Use this on a replacement computer with your restaurant code and recovery key.
          </p>
          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <Input
              label="Restaurant code"
              value={restaurantCodeInput}
              onChange={(e) => setRestaurantCodeInput(e.target.value)}
              placeholder="RN-XXXXX"
            />
            <Input
              label="Recovery key"
              value={recoveryKeyInput}
              onChange={(e) => setRecoveryKeyInput(e.target.value)}
              placeholder="XXXX-XXXX-…"
            />
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void onRecoverCloud()}>
              {busy === "recover" ? "Recovering…" : "Recover Restaurant"}
            </Button>
          </div>
        </div>
      ) : null}

      {showHistory ? (
        <div className="pos-card pos-card-p" style={{ marginBottom: 24 }} data-settings-sec="backup">
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
            {history.length === 0 && cloudItems.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--pos-tx-muted)" }}>No backup records yet.</div>
            ) : null}
            {history.slice(0, 30).map((row) => (
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
                    {String(row.destination || "").startsWith("cloud") ? "Cloud" : "Local"} backup
                    {row.status === "failed" || row.status === "upload_pending" ? ` (${row.status})` : ""}
                  </div>
                  <div style={{ color: "var(--pos-tx-muted)" }}>{formatWhen(row.created_at)}</div>
                </div>
                {row.destination === "local" && String(row.path_or_provider || "").endsWith(".rnbak") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      setConfirm({
                        kind: "restore-local",
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
            {cloudItems.map((item) => (
              <div
                key={`cloud-${item.id}`}
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
                  <div style={{ fontWeight: 600 }}>Cloud backup</div>
                  <div style={{ color: "var(--pos-tx-muted)" }}>{formatWhen(item.createdAt)}</div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    setConfirm({
                      kind: "restore-cloud",
                      id: item.id,
                      label: formatWhen(item.createdAt),
                    })
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(recoveryKey)}
        title="Cloud Backup Recovery Key"
        confirmLabel="I've Saved It"
        cancelLabel="Close"
        onCancel={() => setRecoveryKey(null)}
        onConfirm={() => setRecoveryKey(null)}
      >
        <p>Save this somewhere safe. You will need it if this computer is lost, damaged, or replaced.</p>
        {status?.restaurantCode ? <p>Restaurant code: {status.restaurantCode}</p> : null}
        <pre className="ui-confirm-details" style={{ whiteSpace: "pre-wrap" }}>
          {recoveryKey}
        </pre>
        <div style={{ marginTop: 12 }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (recoveryKey) {
                void exportRecoveryKeyFile(recoveryKey).catch(() => undefined);
              }
            }}
          >
            Download Recovery Key
          </Button>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(confirm)}
        title="Restore Backup?"
        confirmLabel="Restore Backup"
        cancelLabel="Cancel"
        loading={busy === "restore"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runRestore()}
      >
        <p>
          This will replace the current restaurant database with the selected backup
          {confirm ? ` from ${confirm.label}` : ""}.
        </p>
        <p>A safety backup of your current data will be created first. The app will restart after restore.</p>
      </ConfirmModal>
    </>
  );
}
