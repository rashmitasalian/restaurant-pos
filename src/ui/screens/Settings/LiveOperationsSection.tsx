import React from "react";
import { AuthContext } from "../../context/AuthContext";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { reportClientError } from "../../../app/utils/clientError";
import {
  cancelLiveOperations,
  commitLiveOperations,
  completeInterruptedRestore,
  getLiveOperationsStatus,
  prepareLiveOperations,
  relaunchAfterBackupRestore,
  repairOperationsSidecar,
} from "../../../app/db/posRepository";

const START_LIVE_PHRASE = "START LIVE";

type Counts = {
  openOrders: number;
  paidOrders: number;
  payments: number;
  creditEntries: number;
  expenses: number;
  purchases: number;
  buyingLists: number;
  attendance: number;
  salaryAdvances: number;
  printJobs: number;
};

function countLine(label: string, value: number) {
  return `${label}: ${value}`;
}

export function LiveOperationsSection() {
  const auth = React.useContext(AuthContext);
  const isAdmin = auth?.session?.role === "admin";
  const [status, setStatus] = React.useState<any>(null);
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [phrase, setPhrase] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const next = await getLiveOperationsStatus();
    setStatus(next);
    return next;
  }, []);

  React.useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void refresh().catch((error) =>
      setMessage(reportClientError("settings.live-operations.status", error, "Could not load live operations status")),
    );
  }, [isAdmin, refresh]);

  if (!isAdmin) {
    return null;
  }

  const onPrepare = async () => {
    setBusy("prepare");
    setMessage(null);
    try {
      const prepared = await prepareLiveOperations();
      setCounts(prepared.counts);
      setPhrase("");
      setMessage("New billing is paused. Confirm the counts below, then type START LIVE.");
    } catch (error) {
      setCounts(null);
      setMessage(reportClientError("settings.live-operations.prepare", error, "Could not prepare live operations"));
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async () => {
    setBusy("cancel");
    setMessage(null);
    try {
      await cancelLiveOperations();
      setCounts(null);
      setPhrase("");
      setMessage("Go-live cancelled. Billing can continue.");
      await refresh();
    } catch (error) {
      setMessage(reportClientError("settings.live-operations.cancel", error, "Could not cancel go-live"));
    } finally {
      setBusy(null);
    }
  };

  const onCommit = async () => {
    setBusy("commit");
    setMessage(null);
    try {
      const result = await commitLiveOperations(phrase);
      setCounts(result.counts || counts);
      if (result.sidecarStatus === "repair-required") {
        setMessage("Live operations are recorded. The recovery file still needs repair before normal billing.");
        await refresh();
        return;
      }
      setMessage("Live operations started. Restarting…");
      await relaunchAfterBackupRestore();
    } catch (error) {
      setMessage(reportClientError("settings.live-operations.commit", error, "Could not start live operations"));
    } finally {
      setBusy(null);
    }
  };

  const onRepair = async () => {
    setBusy("repair");
    setMessage(null);
    try {
      await repairOperationsSidecar();
      setMessage("Recovery file repaired. Restarting…");
      await relaunchAfterBackupRestore();
    } catch (error) {
      setMessage(reportClientError("settings.live-operations.repair", error, "Could not repair the recovery file"));
    } finally {
      setBusy(null);
    }
  };

  const onCompleteRestore = async () => {
    setBusy("restore");
    setMessage(null);
    try {
      await completeInterruptedRestore();
      setMessage("Restore recovery completed. Restarting…");
      await refresh();
      await relaunchAfterBackupRestore();
    } catch (error) {
      setMessage(
        reportClientError("settings.live-operations.complete-restore", error, "Could not complete the interrupted restore"),
      );
    } finally {
      setBusy(null);
    }
  };

  const phase = String(status?.phase || "practice");
  const startedAt = status?.marker?.liveStartedAt ? new Date(status.marker.liveStartedAt).toLocaleString() : "";

  return (
    <div className="pos-card pos-card-p" data-settings-sec="backup" id="settings-sec-live-operations" style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "var(--pos-muted,var(--pos-tx-muted))",
          marginBottom: 8,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Start live operations
      </div>
      <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", margin: "0 0 12px", lineHeight: 1.5 }}>
        Practice bills and KOTs stay in History until you start live operations. Menu, staff, tables, printers, and GST settings stay. Practice slips are marked and do not use tax invoice numbers.
      </p>
      {phase === "live" && !status?.blockReason && (
        <p style={{ fontSize: 13, margin: "0 0 12px" }}>Live operations started {startedAt}.</p>
      )}
      {status?.blockReason && (
        <p style={{ fontSize: 13, margin: "0 0 12px" }}>
          Recovery is required ({String(status.blockReason)}). Billing stays paused until this is repaired.
        </p>
      )}
      {counts && (
        <ul style={{ fontSize: 13, margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>{countLine("Open orders", counts.openOrders)}</li>
          <li>{countLine("Paid bills", counts.paidOrders)}</li>
          <li>{countLine("Payments", counts.payments)}</li>
          <li>{countLine("Credit entries", counts.creditEntries)}</li>
          <li>{countLine("Expenses", counts.expenses)}</li>
          <li>{countLine("Purchases", counts.purchases)}</li>
          <li>{countLine("Buying lists", counts.buyingLists)}</li>
          <li>{countLine("Attendance", counts.attendance)}</li>
          <li>{countLine("Salary advances", counts.salaryAdvances)}</li>
          <li>{countLine("Print jobs", counts.printJobs)}</li>
        </ul>
      )}
      {counts && (
        <div style={{ maxWidth: 280, marginBottom: 12 }}>
          <Input
            label="Type START LIVE"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {phase === "practice" && !counts && (
          <Button type="button" variant="primary" onClick={onPrepare} disabled={busy !== null}>
            {busy === "prepare" ? "Preparing..." : "Prepare go-live"}
          </Button>
        )}
        {counts && (
          <>
            <Button type="button" variant="primary" onClick={onCommit} disabled={busy !== null || phrase !== START_LIVE_PHRASE}>
              {busy === "commit" ? "Starting..." : "Start live operations"}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy !== null}>
              Cancel
            </Button>
          </>
        )}
        {status?.blockReason === "sidecar-repair-required" && (
          <Button type="button" variant="primary" onClick={onRepair} disabled={busy !== null}>
            Repair recovery file
          </Button>
        )}
        {status?.intent && (
          <Button type="button" variant="primary" onClick={onCompleteRestore} disabled={busy !== null}>
            Complete interrupted restore
          </Button>
        )}
      </div>
      {message && (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>{message}</div>
      )}
    </div>
  );
}
