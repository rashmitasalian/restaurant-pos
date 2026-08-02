import React from "react";
import { ENV } from "../../../config/env";
import { AuthContext } from "../../context/AuthContext";
import {
  getConfigPrinters,
  setConfigPrinters,
  getConfigTables,
  setConfigTables,
  seedTables,
  getConfigCategories,
  getConfigMenuVariantOptions,
  setConfigCategories,
  setConfigMenuVariantOptions,
  getConfigAudit,
  setConfigAudit,
  getConfigHistory,
  setConfigHistory,
  getConfigShifts,
  setConfigShifts,
  regenerateRecoveryCodes,
  getConfigGst,
  setConfigGst,
  getConfigBranding,
  setConfigBranding,
  listPrintJobs,
  retryPrintJob,
  clearOldPrintJobs,
  createSqliteBackup,
  restoreSqliteBackup,
  listSqliteBackups,
  getAppInfo,
  checkForUpdates,
  prepareUpdate,
  launchPreparedUpdate,
  getUpdateStatus,
  rollbackLastUpdate,
  exportDiagnostics,
  type AttendanceShiftConfig,
  type PrintJobDoc,
} from "../../../app/db/posRepository";
import { DEFAULT_GST_CONFIG, isValidGstin, normalizeGstConfig } from "../../../shared/gst";
import { RECOVERY_CODE_COUNT } from "../../../shared/auth";
import { normalizeCategoryName, validationMessage } from "../../../shared/validation";
import { processRestaurantLogoFile, type ReceiptLogoRaster } from "../../utils/logoProcessing";

const DEFAULT_ATTENDANCE_SHIFTS: AttendanceShiftConfig[] = [
  { id: "morning", label: "Morning", hours: 8 },
  { id: "evening", label: "Evening", hours: 8 },
  { id: "night", label: "Night", hours: 8 },
  { id: "half-day", label: "Half Day", hours: 4 },
];

function mergeShiftConfig(input: AttendanceShiftConfig[]) {
  const map = new Map(
    (Array.isArray(input) ? input : []).map((entry) => [entry.id.toLowerCase(), entry]),
  );
  return DEFAULT_ATTENDANCE_SHIFTS.map((base) => {
    const found = map.get(base.id);
    const hours = Number(found?.hours);
    return {
      id: base.id,
      label: String(found?.label || base.label),
      hours: Number.isFinite(hours) && hours > 0 ? hours : base.hours,
    };
  });
}

export default function Settings() {
  const auth = React.useContext(AuthContext);
  const [kitchenIp, setKitchenIp] = React.useState("");
  const [counterIp, setCounterIp] = React.useState("");
  const [port, setPort] = React.useState<number>(9100);
  const [status, setStatus] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testingPrinter, setTestingPrinter] = React.useState<"kitchen" | "counter" | null>(null);
  const [recoveryPassword, setRecoveryPassword] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [recoveryStatus, setRecoveryStatus] = React.useState<string | null>(null);
  const [regeneratingRecovery, setRegeneratingRecovery] = React.useState(false);
  const [printJobs, setPrintJobs] = React.useState<PrintJobDoc[]>([]);
  const [printQueueStatus, setPrintQueueStatus] = React.useState<string | null>(null);
  const [loadingPrintQueue, setLoadingPrintQueue] = React.useState(false);
  const [retryingPrintJob, setRetryingPrintJob] = React.useState<string | null>(null);
  const [clearingPrintJobs, setClearingPrintJobs] = React.useState(false);
  const [backups, setBackups] = React.useState<any[]>([]);
  const [backupStatus, setBackupStatus] = React.useState<string | null>(null);
  const [backupBusy, setBackupBusy] = React.useState<"create" | "restore" | "load" | null>(null);
  const [appInfo, setAppInfo] = React.useState<any>(null);
  const [updateStatus, setUpdateStatus] = React.useState<any>(null);
  const [updateCheck, setUpdateCheck] = React.useState<any>(null);
  const [updateMessage, setUpdateMessage] = React.useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = React.useState<
    "check" | "prepare" | "launch" | "rollback" | "diagnostics" | null
  >(null);
  const [hotelName, setHotelName] = React.useState(ENV.HOTEL_NAME);
  const [hotelInitials, setHotelInitials] = React.useState(ENV.HOTEL_INITIALS);
  const [hotelTagline, setHotelTagline] = React.useState("POINT OF SALE");
  const [hotelPhone, setHotelPhone] = React.useState(ENV.HOTEL_PHONE);
  const [hotelEmail, setHotelEmail] = React.useState(ENV.HOTEL_EMAIL);
  const [hotelLogoDataUrl, setHotelLogoDataUrl] = React.useState<string | null>(null);
  const [receiptLogoRaster, setReceiptLogoRaster] = React.useState<ReceiptLogoRaster | null>(null);
  const [brandingStatus, setBrandingStatus] = React.useState<string | null>(null);
  const [savingBranding, setSavingBranding] = React.useState(false);
  const [processingLogo, setProcessingLogo] = React.useState(false);

  // GST / business registration config
  const [gstEnabled, setGstEnabled] = React.useState(DEFAULT_GST_CONFIG.enabled);
  const [gstin, setGstin] = React.useState(DEFAULT_GST_CONFIG.gstin);
  const [gstLegalName, setGstLegalName] = React.useState(DEFAULT_GST_CONFIG.legalName);
  const [gstRegisteredAddress, setGstRegisteredAddress] = React.useState(
    DEFAULT_GST_CONFIG.registeredAddress,
  );
  const [gstStateCode, setGstStateCode] = React.useState(DEFAULT_GST_CONFIG.stateCode);
  const [gstStateName, setGstStateName] = React.useState(DEFAULT_GST_CONFIG.stateName);
  const [gstRate, setGstRate] = React.useState(DEFAULT_GST_CONFIG.gstRateBps / 100);
  const [gstPriceIncludesTax, setGstPriceIncludesTax] = React.useState(
    DEFAULT_GST_CONFIG.priceIncludesTax,
  );
  const [gstStatus, setGstStatus] = React.useState<string | null>(null);
  const [savingGst, setSavingGst] = React.useState(false);

  // â”€â”€ Tables config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [tableCount, setTableCount] = React.useState<number>(ENV.TABLE_COUNT);
  const [tableStatus, setTableStatus] = React.useState<string | null>(null);
  const [savingTables, setSavingTables] = React.useState(false);

  // ── Audit retention config ──────────────────────────────────────────────────
  const [retentionDays, setRetentionDays] = React.useState<number | null>(90);
  const [auditStatus, setAuditStatus] = React.useState<string | null>(null);
  const [savingAudit, setSavingAudit] = React.useState(false);

  // ── Order history retention config ───────────────────────────────────────────
  const [historyRetentionDays, setHistoryRetentionDays] = React.useState<number | null>(null);
  const [historyStatus, setHistoryStatus] = React.useState<string | null>(null);
  const [savingHistory, setSavingHistory] = React.useState(false);

  // ── Attendance shift config ────────────────────────────────────────────────
  const [attendanceShifts, setAttendanceShifts] = React.useState<AttendanceShiftConfig[]>(
    DEFAULT_ATTENDANCE_SHIFTS,
  );
  const [shiftStatus, setShiftStatus] = React.useState<string | null>(null);
  const [savingShifts, setSavingShifts] = React.useState(false);

  // ── Categories config ────────────────────────────────────────────────────────
  const [categories, setCategories] = React.useState<string[]>([]);
  const [newCategory, setNewCategory] = React.useState("");
  const [categoryStatus, setCategoryStatus] = React.useState<string | null>(null);
  const [savingCategories, setSavingCategories] = React.useState(false);
  const [menuVariantOptions, setMenuVariantOptions] = React.useState<string[]>([]);
  const [newMenuVariantOption, setNewMenuVariantOption] = React.useState("");
  const [menuVariantStatus, setMenuVariantStatus] = React.useState<string | null>(null);
  const [savingMenuVariantOptions, setSavingMenuVariantOptions] = React.useState(false);
  const actionInFlightRef = React.useRef<Record<string, boolean>>({});

  const beginAction = React.useCallback((key: string) => {
    if (actionInFlightRef.current[key]) {
      return false;
    }
    actionInFlightRef.current[key] = true;
    return true;
  }, []);

  const endAction = React.useCallback((key: string) => {
    delete actionInFlightRef.current[key];
  }, []);

  const loadPrintQueue = React.useCallback(async () => {
    if (!beginAction("printQueue.load")) {
      return;
    }
    setLoadingPrintQueue(true);
    try {
      setPrintJobs(await listPrintJobs());
    } catch (e: any) {
      setPrintQueueStatus("Could not load print queue: " + (e?.message || String(e)));
    } finally {
      endAction("printQueue.load");
      setLoadingPrintQueue(false);
    }
  }, [beginAction, endAction]);

  const loadBackups = React.useCallback(async () => {
    if (!beginAction("backup.load")) {
      return;
    }
    setBackupBusy("load");
    try {
      setBackups(await listSqliteBackups());
    } catch (e: any) {
      setBackupStatus("Could not load backups: " + (e?.message || String(e)));
    } finally {
      endAction("backup.load");
      setBackupBusy(null);
    }
  }, [beginAction, endAction]);

  const loadUpdateSupport = React.useCallback(async () => {
    try {
      const [info, status] = await Promise.all([getAppInfo(), getUpdateStatus()]);
      setAppInfo(info);
      setUpdateStatus(status);
    } catch (e: any) {
      setUpdateMessage("Could not load update support details: " + (e?.message || String(e)));
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfigPrinters();
        if (cfg) {
          setKitchenIp(cfg.kitchenPrinterIp || "");
          setCounterIp(cfg.counterPrinterIp || "");
          setPort(cfg.printerPort || 9100);
        }
      } catch (e) {}
      try {
        const branding = await getConfigBranding();
        setHotelName(branding.hotelName || ENV.HOTEL_NAME);
        setHotelInitials(branding.hotelInitials || ENV.HOTEL_INITIALS);
        setHotelTagline(branding.tagline || "POINT OF SALE");
        setHotelPhone(branding.phone || ENV.HOTEL_PHONE);
        setHotelEmail(branding.email || ENV.HOTEL_EMAIL);
        setHotelLogoDataUrl(typeof branding.logoDataUrl === "string" ? branding.logoDataUrl : null);
        setReceiptLogoRaster((branding.receiptLogoRaster as ReceiptLogoRaster | null) || null);
      } catch (e) {}
      try {
        const tCfg = await getConfigTables();
        if (tCfg) {
          setTableCount(tCfg.tableCount);
        }
      } catch (e) {}
      try {
        setCategories(await getConfigCategories());
      } catch (e) {}
      try {
        setMenuVariantOptions(await getConfigMenuVariantOptions());
      } catch (e) {}
      try {
        const auditCfg = await getConfigAudit();
        setRetentionDays(auditCfg.retentionDays);
      } catch (e) {}
      try {
        const historyCfg = await getConfigHistory();
        setHistoryRetentionDays(historyCfg.retentionDays);
      } catch (e) {}
      try {
        const shifts = await getConfigShifts();
        setAttendanceShifts(mergeShiftConfig(shifts));
      } catch (e) {}
      try {
        const gstCfg = normalizeGstConfig(await getConfigGst());
        setGstEnabled(gstCfg.enabled);
        setGstin(gstCfg.gstin);
        setGstLegalName(gstCfg.legalName);
        setGstRegisteredAddress(gstCfg.registeredAddress);
        setGstStateCode(gstCfg.stateCode);
        setGstStateName(gstCfg.stateName);
        setGstRate(gstCfg.gstRateBps / 100);
        setGstPriceIncludesTax(gstCfg.priceIncludesTax);
      } catch (e) {}
      await loadPrintQueue();
      await loadBackups();
      await loadUpdateSupport();
    })();
  }, [loadBackups, loadPrintQueue, loadUpdateSupport]);

  const isValidIpOrHost = (s: string) => {
    if (!s.trim()) {
      return true;
    }
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostname = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/;
    if (ipv4.test(s)) {
      return s.split(".").every((oct) => parseInt(oct, 10) <= 255);
    }
    return hostname.test(s);
  };

  const handleSave = async () => {
    if (!beginAction("printers.save")) {
      return;
    }
    if (!isValidIpOrHost(kitchenIp)) {
      endAction("printers.save");
      setStatus("Invalid Kitchen Printer IP address or hostname");
      return;
    }
    if (!isValidIpOrHost(counterIp)) {
      endAction("printers.save");
      setStatus("Invalid Counter Printer IP address or hostname");
      return;
    }
    if (port < 1 || port > 65535) {
      endAction("printers.save");
      setStatus("Port must be between 1 and 65535");
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await setConfigPrinters({
        kitchenPrinterIp: kitchenIp,
        counterPrinterIp: counterIp,
        printerPort: port,
      });
      setStatus("Saved successfully ✓");
      setTimeout(() => setStatus(null), 3000);
    } catch (e: any) {
      setStatus("Save failed: " + (e?.message || String(e)));
    }
    setSaving(false);
    endAction("printers.save");
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!beginAction("branding.logo")) {
      return;
    }
    setProcessingLogo(true);
    setBrandingStatus(null);
    try {
      const processed = await processRestaurantLogoFile(file);
      setHotelLogoDataUrl(processed.logoDataUrl);
      setReceiptLogoRaster(processed.receiptLogoRaster);
      setBrandingStatus("Logo ready. Save Business Identity to apply it.");
    } catch (e: any) {
      setBrandingStatus(e?.message || "Could not process logo");
    } finally {
      endAction("branding.logo");
      setProcessingLogo(false);
    }
  };

  const removeLogo = () => {
    setHotelLogoDataUrl(null);
    setReceiptLogoRaster(null);
    setBrandingStatus("Logo removed. Save Business Identity to apply it.");
  };

  const saveBranding = async () => {
    if (!beginAction("branding.save")) {
      return;
    }
    const name = hotelName.trim();
    if (!name) {
      endAction("branding.save");
      setBrandingStatus("Hotel name is required");
      return;
    }
    setSavingBranding(true);
    setBrandingStatus(null);
    try {
      const initials =
        hotelInitials.trim() ||
        name
          .split(/\s+/)
          .map((part: string) => part[0])
          .join("")
          .slice(0, 3)
          .toUpperCase();
      const saved = await setConfigBranding({
        hotelName: name,
        hotelInitials: initials,
        tagline: hotelTagline.trim() || "POINT OF SALE",
        phone: hotelPhone.trim(),
        email: hotelEmail.trim(),
        logoDataUrl: hotelLogoDataUrl,
        receiptLogoRaster,
        logoUpdatedAt: hotelLogoDataUrl ? Date.now() : 0,
      });
      setHotelName(saved.hotelName || name);
      setHotelInitials(saved.hotelInitials || initials);
      setHotelTagline(saved.tagline || "POINT OF SALE");
      setHotelPhone(saved.phone || "");
      setHotelEmail(saved.email || "");
      setHotelLogoDataUrl(typeof saved.logoDataUrl === "string" ? saved.logoDataUrl : null);
      setReceiptLogoRaster((saved.receiptLogoRaster as ReceiptLogoRaster | null) || null);
      window.dispatchEvent(new Event("branding-changed"));
      setBrandingStatus("Business identity saved");
      setTimeout(() => setBrandingStatus(null), 3000);
    } catch (e: any) {
      setBrandingStatus("Save failed: " + (e?.message || String(e)));
    } finally {
      endAction("branding.save");
      setSavingBranding(false);
    }
  };

  const saveGstConfig = async () => {
    if (!beginAction("gst.save")) {
      return;
    }
    const normalizedGstin = gstin.trim().toUpperCase();
    if (gstEnabled && !normalizedGstin) {
      endAction("gst.save");
      setGstStatus("GSTIN is required to print GST registration details");
      return;
    }
    if (normalizedGstin && !isValidGstin(normalizedGstin)) {
      endAction("gst.save");
      setGstStatus("Enter a valid 15-character GSTIN");
      return;
    }
    if (gstRate < 0 || gstRate > 28) {
      endAction("gst.save");
      setGstStatus("GST rate must be between 0 and 28");
      return;
    }

    setSavingGst(true);
    setGstStatus(null);
    try {
      const saved = await setConfigGst({
        enabled: gstEnabled,
        gstin: normalizedGstin,
        legalName: gstLegalName,
        registeredAddress: gstRegisteredAddress,
        stateCode: gstStateCode,
        stateName: gstStateName,
        gstRateBps: Math.round(Number(gstRate || 0) * 100),
        priceIncludesTax: gstPriceIncludesTax,
      });
      const cfg = normalizeGstConfig(saved);
      setGstEnabled(cfg.enabled);
      setGstin(cfg.gstin);
      setGstLegalName(cfg.legalName);
      setGstRegisteredAddress(cfg.registeredAddress);
      setGstStateCode(cfg.stateCode);
      setGstStateName(cfg.stateName);
      setGstRate(cfg.gstRateBps / 100);
      setGstPriceIncludesTax(cfg.priceIncludesTax);
      window.dispatchEvent(new Event("orders-changed"));
      setGstStatus("GST details saved");
      setTimeout(() => setGstStatus(null), 3000);
    } catch (e: any) {
      setGstStatus("Save failed: " + (e?.message || String(e)));
    } finally {
      endAction("gst.save");
      setSavingGst(false);
    }
  };

  const visiblePrintJobs = printJobs.filter((job) => job.status !== "completed");
  const formatDateTime = (value?: number) => {
    if (!value) {
      return "-";
    }
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const retryQueuedPrint = async (jobId: string) => {
    if (!beginAction(`printQueue.retry.${jobId}`)) {
      return;
    }
    setRetryingPrintJob(jobId);
    setPrintQueueStatus(null);
    try {
      const ok = await retryPrintJob(jobId);
      await loadPrintQueue();
      setPrintQueueStatus(ok ? "Print job completed" : "Retry failed; job remains in queue");
    } catch (e: any) {
      setPrintQueueStatus("Retry failed: " + (e?.message || String(e)));
    } finally {
      endAction(`printQueue.retry.${jobId}`);
      setRetryingPrintJob(null);
    }
  };

  const clearCompletedPrintJobs = async () => {
    if (!beginAction("printQueue.clear")) {
      return;
    }
    setClearingPrintJobs(true);
    setPrintQueueStatus(null);
    try {
      const deleted = await clearOldPrintJobs(24);
      await loadPrintQueue();
      setPrintQueueStatus(`Cleared ${deleted} old completed/failed print jobs`);
    } catch (e: any) {
      setPrintQueueStatus("Cleanup failed: " + (e?.message || String(e)));
    } finally {
      setClearingPrintJobs(false);
      endAction("printQueue.clear");
    }
  };

  const createBackup = async () => {
    if (!beginAction("backup.create")) {
      return;
    }
    setBackupBusy("create");
    setBackupStatus(null);
    try {
      const result = await createSqliteBackup();
      if (result?.ok === false) {
        setBackupStatus(result.reason === "cancelled" ? "Backup cancelled" : "Backup was not created");
      } else {
        await loadBackups();
        setBackupStatus("Backup created");
      }
    } catch (e: any) {
      setBackupStatus("Backup failed: " + (e?.message || String(e)));
    } finally {
      endAction("backup.create");
      setBackupBusy(null);
    }
  };

  const restoreBackup = async () => {
    if (!beginAction("backup.restore")) {
      return;
    }
    if (!window.confirm("Restore replaces the current POS database. A safety backup will be created first. Continue?")) {
      endAction("backup.restore");
      return;
    }
    setBackupBusy("restore");
    setBackupStatus(null);
    try {
      const result = await restoreSqliteBackup();
      if (result?.ok === false) {
        setBackupStatus(result.reason === "cancelled" ? "Restore cancelled" : "Restore was not completed");
      } else {
        setBackupStatus("Restore completed. Reloading...");
        window.setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e: any) {
      setBackupStatus("Restore failed: " + (e?.message || String(e)));
    } finally {
      endAction("backup.restore");
      setBackupBusy(null);
    }
  };

  const businessActivityText = (activity: any) => {
    if (!activity) {
      return "";
    }
    return [
      `Open orders: ${activity.openOrders || 0}`,
      `Pending KOTs: ${activity.pendingKots || 0}`,
      `Pending print jobs: ${activity.pendingPrintJobs || 0}`,
      `Failed print jobs: ${activity.failedPrintJobs || 0}`,
    ].join("\n");
  };

  const checkUpdate = async () => {
    if (!beginAction("update.check")) {
      return;
    }
    setUpdateBusy("check");
    setUpdateMessage(null);
    try {
      const result = await checkForUpdates();
      setUpdateCheck(result);
      await loadUpdateSupport();
      if (result?.configured === false) {
        setUpdateMessage("Update manifest URL is not configured on this machine.");
      } else if (result?.updateAvailable) {
        setUpdateMessage(`Update ${result.manifest?.version} is available.`);
      } else {
        setUpdateMessage("This POS is already up to date.");
      }
    } catch (e: any) {
      setUpdateMessage("Update check failed: " + (e?.message || String(e)));
    } finally {
      endAction("update.check");
      setUpdateBusy(null);
    }
  };

  const preparePosUpdate = async (allowBusinessActivity = false) => {
    if (!beginAction("update.prepare")) {
      return;
    }
    setUpdateBusy("prepare");
    setUpdateMessage(null);
    try {
      let result = await prepareUpdate({ allowBusinessActivity });
      if (result?.ok === false && result.reason === "business-activity") {
        const confirmed = window.confirm(
          `Business activity detected:\n\n${businessActivityText(result.businessActivity)}\n\nUpdating now may interrupt operations. Continue anyway?`,
        );
        if (confirmed) {
          result = await prepareUpdate({ allowBusinessActivity: true });
        } else {
          setUpdateMessage("Update preparation cancelled.");
          return;
        }
      }
      await loadUpdateSupport();
      setUpdateMessage("Update prepared. Backup and installers are verified.");
    } catch (e: any) {
      setUpdateMessage("Prepare update failed: " + (e?.message || String(e)));
    } finally {
      endAction("update.prepare");
      setUpdateBusy(null);
    }
  };

  const launchUpdate = async () => {
    if (!beginAction("update.launch")) {
      return;
    }
    if (!window.confirm("The POS will close and the installer will open. Continue?")) {
      endAction("update.launch");
      return;
    }
    setUpdateBusy("launch");
    setUpdateMessage(null);
    try {
      await launchPreparedUpdate();
      setUpdateMessage("Installer launched. Complete the installer to finish the update.");
    } catch (e: any) {
      setUpdateMessage("Could not launch installer: " + (e?.message || String(e)));
      setUpdateBusy(null);
    } finally {
      endAction("update.launch");
    }
  };

  const rollbackUpdate = async () => {
    if (!beginAction("update.rollback")) {
      return;
    }
    let launched = false;
    setUpdateBusy("rollback");
    setUpdateMessage(null);
    try {
      const first = await rollbackLastUpdate();
      if (first?.ok === false && first.reason === "confirmation-required") {
        const risk = first.risk || {};
        const confirmed = window.confirm(
          `Rollback will restore the database to the pre-update backup.\n\nOrders created after update: ${risk.orders || 0}\nPayments created after update: ${risk.payments || 0}\n\nThese records will be lost. Continue?`,
        );
        if (!confirmed) {
          setUpdateMessage("Rollback cancelled.");
          setUpdateBusy(null);
          return;
        }
        await rollbackLastUpdate({ confirmed: true });
      }
      launched = true;
      setUpdateMessage("Rollback installer launched. Complete the installer to finish rollback.");
    } catch (e: any) {
      setUpdateMessage("Rollback failed: " + (e?.message || String(e)));
      setUpdateBusy(null);
    } finally {
      endAction("update.rollback");
      if (!launched) {
        setUpdateBusy(null);
      }
    }
  };

  const exportSupportDiagnostics = async () => {
    if (!beginAction("update.diagnostics")) {
      return;
    }
    setUpdateBusy("diagnostics");
    setUpdateMessage(null);
    try {
      const result = await exportDiagnostics();
      setUpdateMessage(`Diagnostics exported: ${result?.path || "complete"}`);
    } catch (e: any) {
      setUpdateMessage("Diagnostics export failed: " + (e?.message || String(e)));
    } finally {
      endAction("update.diagnostics");
      setUpdateBusy(null);
    }
  };

  const doTestPrint = async (printer: "kitchen" | "counter") => {
    if (!beginAction(`printer.test.${printer}`)) {
      return;
    }
    setTestingPrinter(printer);
    setStatus(`Testing ${printer}...`);
    try {
      // @ts-ignore
      const res = await window.pos.testPrint(printer);
      if (res?.ok) {
        setStatus(`${printer} printer reachable ✓`);
        setTimeout(() => setStatus(null), 3000);
      } else {
        setStatus(`${printer} failed: ${res?.error || "unknown"}`);
      }
    } catch (e: any) {
      setStatus(`${printer} failed: ${e?.message || String(e)}`);
    } finally {
      setTestingPrinter(null);
      endAction(`printer.test.${printer}`);
    }
  };

  const saveTables = async () => {
    if (!beginAction("tables.save")) {
      return;
    }
    if (tableCount < 1 || tableCount > 100) {
      endAction("tables.save");
      setTableStatus("Table count must be between 1 and 100");
      return;
    }
    setSavingTables(true);
    setTableStatus(null);
    try {
      await setConfigTables(tableCount);
      await seedTables(tableCount);
      window.dispatchEvent(new Event("orders-changed"));
      setTableStatus("Saved ✓");
      setTimeout(() => setTableStatus(null), 4000);
    } catch (e: any) {
      setTableStatus("Save failed: " + (e?.message || String(e)));
    } finally {
      setSavingTables(false);
      endAction("tables.save");
    }
  };

  const addCategory = () => {
    const trimmed = normalizeCategoryName(newCategory);
    if (!trimmed) {
      setCategoryStatus(validationMessage("category-name-required"));
      setTimeout(() => setCategoryStatus(null), 2500);
      return;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCategoryStatus(validationMessage("category-name-duplicate"));
      setTimeout(() => setCategoryStatus(null), 2500);
      return;
    }
    setCategories((prev) => [...prev, trimmed]);
    setNewCategory("");
  };

  const categoriesIncludingDraft = () => {
    const trimmed = normalizeCategoryName(newCategory);
    if (!trimmed) {
      return categories;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      return null;
    }
    return [...categories, trimmed];
  };

  const removeCategory = (cat: string) => {
    setCategories((prev) => prev.filter((c) => c !== cat));
  };

  const saveCategories = async () => {
    if (!beginAction("categories.save")) {
      return;
    }
    const nextCategories = categoriesIncludingDraft();
    if (!nextCategories) {
      endAction("categories.save");
      setCategoryStatus(validationMessage("category-name-duplicate"));
      setTimeout(() => setCategoryStatus(null), 2500);
      return;
    }
    setSavingCategories(true);
    setCategoryStatus(null);
    try {
      await setConfigCategories(nextCategories);
      setCategories(nextCategories);
      setNewCategory("");
      setCategoryStatus("Saved \u2713");
      setTimeout(() => setCategoryStatus(null), 3000);
    } catch (e: any) {
      setCategoryStatus("Save failed: " + (e?.message || String(e)));
    }
    setSavingCategories(false);
    endAction("categories.save");
  };

  const addMenuVariantOption = () => {
    const trimmed = normalizeCategoryName(newMenuVariantOption);
    if (!trimmed) {
      setMenuVariantStatus(validationMessage("category-name-required"));
      setTimeout(() => setMenuVariantStatus(null), 2500);
      return;
    }
    if (menuVariantOptions.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setMenuVariantStatus(validationMessage("category-name-duplicate"));
      setTimeout(() => setMenuVariantStatus(null), 2500);
      return;
    }
    setMenuVariantOptions((prev) => [...prev, trimmed]);
    setNewMenuVariantOption("");
  };

  const menuVariantOptionsIncludingDraft = () => {
    const trimmed = normalizeCategoryName(newMenuVariantOption);
    if (!trimmed) {
      return menuVariantOptions;
    }
    if (menuVariantOptions.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      return null;
    }
    return [...menuVariantOptions, trimmed];
  };

  const removeMenuVariantOption = (option: string) => {
    setMenuVariantOptions((prev) => prev.filter((entry) => entry !== option));
  };

  const saveMenuVariantOptions = async () => {
    if (!beginAction("menuVariantOptions.save")) {
      return;
    }
    const nextOptions = menuVariantOptionsIncludingDraft();
    if (!nextOptions) {
      endAction("menuVariantOptions.save");
      setMenuVariantStatus(validationMessage("category-name-duplicate"));
      setTimeout(() => setMenuVariantStatus(null), 2500);
      return;
    }
    setSavingMenuVariantOptions(true);
    setMenuVariantStatus(null);
    try {
      await setConfigMenuVariantOptions(nextOptions);
      setMenuVariantOptions(nextOptions);
      setNewMenuVariantOption("");
      setMenuVariantStatus("Saved ✓");
      setTimeout(() => setMenuVariantStatus(null), 3000);
    } catch (e: any) {
      setMenuVariantStatus("Save failed: " + (e?.message || String(e)));
    }
    setSavingMenuVariantOptions(false);
    endAction("menuVariantOptions.save");
  };

  const saveAuditConfig = async () => {
    if (!beginAction("audit.save")) {
      return;
    }
    setSavingAudit(true);
    setAuditStatus(null);
    try {
      await setConfigAudit({ retentionDays });
      setAuditStatus("Saved \u2713");
      setTimeout(() => setAuditStatus(null), 3000);
    } catch (e: any) {
      setAuditStatus("Save failed: " + (e?.message || String(e)));
    }
    setSavingAudit(false);
    endAction("audit.save");
  };

  const saveHistoryConfig = async () => {
    if (!beginAction("history.save")) {
      return;
    }
    setSavingHistory(true);
    setHistoryStatus(null);
    try {
      await setConfigHistory({ retentionDays: historyRetentionDays });
      setHistoryStatus("Saved \u2713");
      setTimeout(() => setHistoryStatus(null), 3000);
    } catch (e: any) {
      setHistoryStatus("Save failed: " + (e?.message || String(e)));
    }
    setSavingHistory(false);
    endAction("history.save");
  };

  const setShiftHours = (id: string, hours: number) => {
    setAttendanceShifts((prev) =>
      prev.map((shift) => (shift.id === id ? { ...shift, hours } : shift)),
    );
  };

  const saveShiftConfig = async () => {
    if (!beginAction("attendance.shifts.save")) {
      return;
    }
    const invalid = attendanceShifts.find(
      (shift) => !Number.isFinite(shift.hours) || shift.hours <= 0 || shift.hours > 24,
    );
    if (invalid) {
      endAction("attendance.shifts.save");
      setShiftStatus("Shift hours must be between 0.5 and 24");
      return;
    }

    setSavingShifts(true);
    setShiftStatus(null);
    try {
      const sanitized = attendanceShifts.map((shift) => ({
        id: shift.id,
        label: shift.label,
        hours: Math.round(shift.hours * 100) / 100,
      }));
      await setConfigShifts(sanitized);
      setAttendanceShifts(sanitized);
      setShiftStatus("Saved ✓");
      setTimeout(() => setShiftStatus(null), 3000);
    } catch (e: any) {
      setShiftStatus("Save failed: " + (e?.message || String(e)));
    }
    setSavingShifts(false);
    endAction("attendance.shifts.save");
  };

  const regenerateAdminRecoveryCodes = async () => {
    if (!beginAction("recovery.regenerate")) {
      return;
    }
    if (!auth?.session?.username || auth.session.role !== "admin") {
      endAction("recovery.regenerate");
      setRecoveryStatus("Only an active admin can regenerate recovery codes.");
      return;
    }
    if (!recoveryPassword) {
      endAction("recovery.regenerate");
      setRecoveryStatus("Enter your current admin password.");
      return;
    }

    setRegeneratingRecovery(true);
    setRecoveryStatus(null);
    try {
      const result = await regenerateRecoveryCodes({
        actorUsername: auth.session.username,
        actorPassword: recoveryPassword,
      });
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryPassword("");
      setRecoveryStatus(`${result.recoveryCodes.length} new recovery codes created. Save them now.`);
    } catch (e: any) {
      const message = e?.message || "";
      if (message === "admin-verification-required" || message === "admin-verification-failed") {
        setRecoveryStatus("Admin password verification failed.");
      } else {
        setRecoveryStatus("Could not regenerate recovery codes.");
      }
    } finally {
      endAction("recovery.regenerate");
      setRegeneratingRecovery(false);
    }
  };

  const updateState = updateStatus?.state || {};
  const updateStateStatus = updateState.status || "idle";
  const updateHealthWarnings = Array.isArray(updateState.healthWarnings)
    ? updateState.healthWarnings
    : [];
  const updateStatusLabel =
    updateStateStatus === "successful"
      ? "Update Successful"
      : updateStateStatus === "warning"
        ? "Update Successful With Warnings"
        : updateStateStatus === "failed"
          ? "Update Failed"
          : updateStateStatus === "aborted"
            ? "Update Aborted"
            : updateStateStatus === "prepared"
              ? "Update Prepared"
              : updateStateStatus === "rolledBack"
                ? "Rollback Started"
                : updateStateStatus === "installing"
                  ? "Update Installing"
                  : "Idle";
  const updateStatusDetail =
    updateStateStatus === "successful"
      ? "Startup verification passed. Database, admin account, settings, and print queue are readable."
      : updateStateStatus === "warning"
        ? "Startup verification passed, but one or more operational warnings need attention."
        : updateStateStatus === "failed"
          ? `Startup verification failed${
              updateState.failureReason ? `: ${updateState.failureReason}.` : "."
            } Export diagnostics or roll back if the POS is not healthy.`
          : updateStateStatus === "aborted"
            ? "The installer did not complete. Export diagnostics or roll back if the POS is not healthy."
            : updateStateStatus === "prepared"
              ? "Backup, installer, and rollback installer are verified. Launch Installer is ready."
              : updateStateStatus === "rolledBack"
                ? "The pre-update database was restored and the rollback installer was launched."
                : "";
  const updateStatusTone =
    updateStateStatus === "failed" || updateStateStatus === "aborted"
      ? "error"
      : updateStateStatus === "warning"
        ? "warning"
        : updateStateStatus === "successful" || updateStateStatus === "prepared" || updateStateStatus === "rolledBack"
          ? "success"
          : "neutral";
  const updateStatusColors =
    updateStatusTone === "error"
      ? { background: "#fee2e2", color: "#991b1b", border: "#fecaca" }
      : updateStatusTone === "warning"
        ? { background: "#fef3c7", color: "#92400e", border: "#fde68a" }
        : updateStatusTone === "success"
          ? { background: "#dcfce7", color: "#166534", border: "#bbf7d0" }
          : { background: "#f9fafb", color: "#374151", border: "#e5e7eb" };
  const updateMessageIsError = Boolean(
    updateMessage?.includes("failed") ||
    updateMessage?.includes("Could not") ||
      updateMessage?.includes("Failed"),
  );

  return (
    <div className="pos-page pos-page-sm">
      {/* Header */}
      <div className="pos-ph" style={{ marginBottom: 28 }}>
        <div>
          <h2 className="pos-ph-title">Settings</h2>
          <p className="pos-ph-sub">Configure your POS system</p>
        </div>
      </div>

      {auth?.session?.role === "admin" && (
        <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--pos-muted,#9ca3af)",
              marginBottom: 14,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Admin Recovery Codes
          </div>

          <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px", lineHeight: 1.6 }}>
            Regenerating creates {RECOVERY_CODE_COUNT} new one-time codes and invalidates all
            unused recovery codes for your admin account. New codes are shown only once.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <input
              type="password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              className="pos-input"
              placeholder="Current admin password"
              autoComplete="current-password"
              style={{ maxWidth: 260 }}
            />
            <button
              type="button"
              onClick={regenerateAdminRecoveryCodes}
              disabled={regeneratingRecovery}
              className="pos-btn pos-btn-primary"
            >
              {regeneratingRecovery ? "Regenerating..." : `Regenerate ${RECOVERY_CODE_COUNT} Codes`}
            </button>
          </div>

          {recoveryStatus && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: recoveryStatus.includes("created") ? "#dcfce7" : "#fee2e2",
                color: recoveryStatus.includes("created") ? "#16a34a" : "#dc2626",
              }}
            >
              {recoveryStatus}
            </div>
          )}

          {recoveryCodes.length > 0 && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 10 }}>
                Save these {recoveryCodes.length} one-time codes now
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 8,
                }}
              >
                {recoveryCodes.map((code) => (
                  <code
                    key={code}
                    style={{
                      padding: "8px 10px",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 7,
                      fontSize: 13,
                      color: "#111827",
                      textAlign: "center",
                      userSelect: "text",
                    }}
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Business Identity Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Business Identity
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label className="pos-label">Hotel Name</label>
            <input
              className="pos-input"
              value={hotelName}
              onChange={(event) => setHotelName(event.target.value)}
              placeholder="Restaurant name"
            />
          </div>
          <div>
            <label className="pos-label">Initials</label>
            <input
              className="pos-input"
              value={hotelInitials}
              onChange={(event) => setHotelInitials(event.target.value.toUpperCase())}
              placeholder="POS"
              maxLength={4}
              style={{ maxWidth: 120 }}
            />
          </div>
          <div>
            <label className="pos-label">Phone</label>
            <input
              className="pos-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={hotelPhone}
              onChange={(event) => setHotelPhone(event.target.value)}
              placeholder="Receipt phone"
            />
          </div>
          <div>
            <label className="pos-label">Email</label>
            <input
              className="pos-input"
              value={hotelEmail}
              onChange={(event) => setHotelEmail(event.target.value)}
              placeholder="Receipt email"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="pos-label">Tagline</label>
            <input
              className="pos-input"
              value={hotelTagline}
              onChange={(event) => setHotelTagline(event.target.value)}
              placeholder="POINT OF SALE"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="pos-label">Restaurant Logo</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "96px 1fr",
                gap: 14,
                alignItems: "center",
                padding: 14,
                border: "1px solid var(--pos-border,#e5e7eb)",
                borderRadius: 10,
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  color: "#94a3b8",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {hotelLogoDataUrl ? (
                  <img
                    src={hotelLogoDataUrl}
                    alt="Restaurant logo preview"
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: 6 }}
                  />
                ) : (
                  hotelInitials || "LOGO"
                )}
              </div>
              <div>
                <input
                  id="restaurant-logo-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    handleLogoUpload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  style={{ display: "none" }}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label
                    htmlFor="restaurant-logo-upload"
                    className="pos-btn"
                    style={{ cursor: processingLogo ? "not-allowed" : "pointer", opacity: processingLogo ? 0.65 : 1 }}
                  >
                    {processingLogo ? "Processing..." : hotelLogoDataUrl ? "Replace Logo" : "Upload Logo"}
                  </label>
                  {hotelLogoDataUrl && (
                    <button type="button" className="pos-btn" onClick={removeLogo}>
                      Remove Logo
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>
                  PNG, JPG, or WebP up to 3 MB. The app will create a small UI logo and a receipt-safe monochrome version.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 16,
            marginTop: 18,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={saveBranding}
            disabled={savingBranding || processingLogo}
            className="pos-btn pos-btn-primary"
          >
            {savingBranding ? "Saving..." : "Save Business Identity"}
          </button>
          {brandingStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background:
                  brandingStatus.includes("saved") ||
                  brandingStatus.includes("ready") ||
                  brandingStatus.includes("removed")
                    ? "#dcfce7"
                    : "#fee2e2",
                color:
                  brandingStatus.includes("saved") ||
                  brandingStatus.includes("ready") ||
                  brandingStatus.includes("removed")
                    ? "#16a34a"
                    : "#dc2626",
              }}
            >
              {brandingStatus}
            </div>
          )}
        </div>
      </div>

      {/* GST Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>GST</span>
          Business GST Details
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "12px 14px",
            border: "1px solid var(--pos-border,#e5e7eb)",
            borderRadius: 10,
            background: gstEnabled ? "#f0fdf4" : "#f9fafb",
            marginBottom: 18,
            cursor: "pointer",
          }}
        >
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "#111827" }}>
              Print GST registration details on bills
            </span>
            <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              GST is still calculated when this is off; only GSTIN/legal details are hidden.
            </span>
          </span>
          <input
            type="checkbox"
            checked={gstEnabled}
            onChange={(event) => setGstEnabled(event.target.checked)}
            style={{ width: 18, height: 18, accentColor: "#16a34a", flexShrink: 0 }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label className="pos-label">GSTIN</label>
            <input
              className="pos-input"
              value={gstin}
              onChange={(event) => setGstin(event.target.value.toUpperCase())}
              placeholder="22AAAAA0000A1Z5"
              maxLength={15}
              style={{ fontFamily: "monospace", textTransform: "uppercase" }}
            />
          </div>
          <div>
            <label className="pos-label">GST Rate (%)</label>
            <input
              className="pos-input"
              type="number"
              min={0}
              max={28}
              step={0.01}
              value={gstRate}
              onChange={(event) => setGstRate(Number(event.target.value))}
              style={{ width: 140 }}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="pos-label">Legal Business Name</label>
            <input
              className="pos-input"
              value={gstLegalName}
              onChange={(event) => setGstLegalName(event.target.value)}
              placeholder="Registered business name"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="pos-label">Registered Address</label>
            <textarea
              className="pos-input"
              value={gstRegisteredAddress}
              onChange={(event) => setGstRegisteredAddress(event.target.value)}
              placeholder="Address printed on GST bills"
              rows={3}
              style={{ resize: "vertical", minHeight: 74 }}
            />
          </div>
          <div>
            <label className="pos-label">State Code</label>
            <input
              className="pos-input"
              value={gstStateCode}
              onChange={(event) => setGstStateCode(event.target.value)}
              placeholder="e.g. 27"
              maxLength={2}
              style={{ width: 120 }}
            />
          </div>
          <div>
            <label className="pos-label">State Name</label>
            <input
              className="pos-input"
              value={gstStateName}
              onChange={(event) => setGstStateName(event.target.value)}
              placeholder="e.g. Maharashtra"
            />
          </div>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 16,
            fontSize: 13,
            color: "#374151",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={gstPriceIncludesTax}
            onChange={(event) => setGstPriceIncludesTax(event.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#d97706" }}
          />
          Menu prices include GST
        </label>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 16,
            marginTop: 18,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={saveGstConfig}
            disabled={savingGst}
            className="pos-btn pos-btn-primary"
          >
            {savingGst ? "Saving..." : "Save GST Details"}
          </button>
          <button
            type="button"
            onClick={() => {
              setGstEnabled(DEFAULT_GST_CONFIG.enabled);
              setGstin(DEFAULT_GST_CONFIG.gstin);
              setGstLegalName(DEFAULT_GST_CONFIG.legalName);
              setGstRegisteredAddress(DEFAULT_GST_CONFIG.registeredAddress);
              setGstStateCode(DEFAULT_GST_CONFIG.stateCode);
              setGstStateName(DEFAULT_GST_CONFIG.stateName);
              setGstRate(DEFAULT_GST_CONFIG.gstRateBps / 100);
              setGstPriceIncludesTax(DEFAULT_GST_CONFIG.priceIncludesTax);
              setGstStatus(null);
            }}
            className="pos-btn pos-btn-secondary"
          >
            Reset Form
          </button>
          {gstStatus && (
            <div
              style={{
                marginLeft: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: gstStatus.includes("saved") ? "#dcfce7" : "#fee2e2",
                color: gstStatus.includes("saved") ? "#16a34a" : "#dc2626",
              }}
            >
              {gstStatus}
            </div>
          )}
        </div>
      </div>

      {/* Printers Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>🖨</span>
          Printer Configuration
        </div>

        {/* Kitchen Printer */}
        <div style={{ marginBottom: 20 }}>
          <label className="pos-label">Kitchen Printer IP Address</label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="text"
              value={kitchenIp}
              onChange={(e) => setKitchenIp(e.target.value)}
              placeholder="e.g., 192.168.1.100"
              className="pos-input"
              style={{ fontFamily: "monospace" }}
            />
            <button
              onClick={() => doTestPrint("kitchen")}
              title="Test configured printer or default printer"
              disabled={testingPrinter !== null}
              className="pos-btn pos-btn-amber-outline"
            >
              {testingPrinter === "kitchen" ? "Testing..." : "Test"}
            </button>
          </div>
        </div>

        {/* Counter Printer */}
        <div style={{ marginBottom: 24 }}>
          <label className="pos-label">Counter Printer IP Address</label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="text"
              value={counterIp}
              onChange={(e) => setCounterIp(e.target.value)}
              placeholder="e.g., 192.168.1.101"
              className="pos-input"
              style={{ fontFamily: "monospace" }}
            />
            <button
              onClick={() => doTestPrint("counter")}
              title="Test configured printer or default printer"
              disabled={testingPrinter !== null}
              className="pos-btn pos-btn-amber-outline"
            >
              {testingPrinter === "counter" ? "Testing..." : "Test"}
            </button>
          </div>
        </div>

        {/* Port */}
        <div style={{ marginBottom: 24 }}>
          <label className="pos-label">Printer Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="pos-input"
            style={{ width: 120, fontFamily: "monospace" }}
          />
          <p style={{ fontSize: 12, color: "var(--pos-muted,#9ca3af)", marginTop: 6 }}>
            Default: 9100 (for network printers)
          </p>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 16,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            className="pos-btn pos-btn-primary"
            style={{
              background: "#16a34a",
              borderColor: "#16a34a",
              boxShadow: "0 2px 8px rgba(22,163,74,0.25)",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            onClick={() => {
              setKitchenIp("");
              setCounterIp("");
              setPort(9100);
              setStatus(null);
            }}
            className="pos-btn pos-btn-secondary"
          >
            Reset
          </button>

          {status && (
            <div
              style={{
                marginLeft: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: status.includes("✓")
                  ? "#dcfce7"
                  : status.includes("failed") || status.includes("Failed")
                    ? "#fee2e2"
                    : "#fef3c7",
                color: status.includes("✓")
                  ? "#16a34a"
                  : status.includes("failed") || status.includes("Failed")
                    ? "#dc2626"
                    : "#b45309",
              }}
            >
              {status}
            </div>
          )}
        </div>
      </div>

      {/* Print Queue Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span>Print Queue</span>
          <button
            type="button"
            onClick={loadPrintQueue}
            disabled={loadingPrintQueue}
            className="pos-btn pos-btn-secondary"
            style={{ padding: "6px 10px", fontSize: 12 }}
          >
            {loadingPrintQueue ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {visiblePrintJobs.length === 0 ? (
          <div
            style={{
              padding: "14px 0",
              color: "#6b7280",
              fontSize: 13,
              borderTop: "1px solid var(--pos-border,#e5e7eb)",
            }}
          >
            No pending or failed print jobs.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {visiblePrintJobs.map((job) => (
              <div
                key={job._id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: 12,
                  border: "1px solid var(--pos-border,#e5e7eb)",
                  borderRadius: 8,
                  background: job.status === "failed" ? "#fff7ed" : "#f9fafb",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>
                    {job.jobType.toUpperCase()} to {job.printerName || "default"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
                    {job.status} - attempts {job.retryCount}/{job.maxRetries} - {formatDateTime(job.createdAt)}
                  </div>
                  {job.error && (
                    <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                      {job.error}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => retryQueuedPrint(job._id)}
                  disabled={retryingPrintJob === job._id}
                  className="pos-btn pos-btn-primary"
                  style={{ padding: "7px 12px", fontSize: 12 }}
                >
                  {retryingPrintJob === job._id ? "Retrying..." : "Retry"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            marginTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={clearCompletedPrintJobs}
            disabled={clearingPrintJobs || loadingPrintQueue}
            className="pos-btn pos-btn-secondary"
          >
            {clearingPrintJobs ? "Clearing..." : "Clear Old Jobs"}
          </button>
          {printQueueStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: printQueueStatus.includes("failed") || printQueueStatus.includes("Could not") || printQueueStatus.includes("Cleanup")
                  ? "#fee2e2"
                  : "#dcfce7",
                color: printQueueStatus.includes("failed") || printQueueStatus.includes("Could not") || printQueueStatus.includes("Cleanup")
                  ? "#dc2626"
                  : "#16a34a",
              }}
            >
              {printQueueStatus}
            </div>
          )}
        </div>
      </div>

      {/* Backup Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          SQLite Backup
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={createBackup}
            disabled={backupBusy !== null}
            className="pos-btn pos-btn-primary"
          >
            {backupBusy === "create" ? "Creating..." : "Create Backup"}
          </button>
          <button
            type="button"
            onClick={restoreBackup}
            disabled={backupBusy !== null}
            className="pos-btn pos-btn-secondary"
          >
            {backupBusy === "restore" ? "Restoring..." : "Restore Backup"}
          </button>
          <button
            type="button"
            onClick={loadBackups}
            disabled={backupBusy !== null}
            className="pos-btn pos-btn-secondary"
          >
            Refresh List
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
            fontSize: 13,
            color: "#6b7280",
          }}
        >
          {backups.length > 0 ? (
            <div>
              Last backup: {formatDateTime(backups[0]?.created_at || backups[0]?.createdAt)} -{" "}
              <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                {backups[0]?.path_or_provider || backups[0]?.path || "local backup"}
              </span>
            </div>
          ) : (
            <div>No backup records yet.</div>
          )}
        </div>

        {backupStatus && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: backupStatus.includes("failed") || backupStatus.includes("Could not")
                ? "#fee2e2"
                : "#dcfce7",
              color: backupStatus.includes("failed") || backupStatus.includes("Could not")
                ? "#dc2626"
                : "#16a34a",
            }}
          >
            {backupStatus}
          </div>
        )}
      </div>

      {/* Update & Support Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 18,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Update & Support
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 16,
            fontSize: 13,
            color: "#374151",
          }}
        >
          <div>
            <div style={{ fontWeight: 800 }}>Current version</div>
            <div>{appInfo?.version || "-"}</div>
          </div>
          <div>
            <div style={{ fontWeight: 800 }}>Update status</div>
            <div>{updateStatusLabel}</div>
          </div>
          <div>
            <div style={{ fontWeight: 800 }}>Latest checked</div>
            <div>{updateCheck?.manifest?.version || updateStatus?.manifest?.version || "-"}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
          Update files:{" "}
          <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            {appInfo?.updateStoragePath || "-"}
          </span>
        </div>

        {updateStatusDetail && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${updateStatusColors.border}`,
              background: updateStatusColors.background,
              color: updateStatusColors.color,
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{updateStatusLabel}</div>
            <div>{updateStatusDetail}</div>
            {updateHealthWarnings.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {updateHealthWarnings.map((warning: string) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {Boolean(updateCheck?.notes?.length || updateCheck?.manifest?.notes?.length) && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--pos-border,#e5e7eb)",
              background: "#f9fafb",
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Release notes</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(updateCheck.notes || updateCheck.manifest?.notes || []).map((note: string) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={checkUpdate}
            disabled={updateBusy !== null}
            className="pos-btn pos-btn-secondary"
          >
            {updateBusy === "check" ? "Checking..." : "Check for Updates"}
          </button>
          <button
            type="button"
            onClick={() => preparePosUpdate(false)}
            disabled={updateBusy !== null || !updateCheck?.updateAvailable}
            className="pos-btn pos-btn-primary"
          >
            {updateBusy === "prepare" ? "Preparing..." : "Prepare Update"}
          </button>
          <button
            type="button"
            onClick={launchUpdate}
            disabled={updateBusy !== null || updateStatus?.state?.status !== "prepared"}
            className="pos-btn pos-btn-primary"
          >
            Launch Installer
          </button>
          <button
            type="button"
            onClick={rollbackUpdate}
            disabled={updateBusy !== null || !updateStatus?.rollbackAvailable}
            className="pos-btn pos-btn-secondary"
          >
            {updateBusy === "rollback" ? "Rolling back..." : "Roll Back Last Update"}
          </button>
          <button
            type="button"
            onClick={exportSupportDiagnostics}
            disabled={updateBusy !== null}
            className="pos-btn pos-btn-secondary"
          >
            {updateBusy === "diagnostics" ? "Exporting..." : "Export Diagnostics"}
          </button>
        </div>

        {updateStatus?.rollbackRisk && updateStatus.rollbackAvailable && (
          <div style={{ marginTop: 12, fontSize: 12, color: "#92400e" }}>
            Rollback would discard {updateStatus.rollbackRisk.orders || 0} order(s) and{" "}
            {updateStatus.rollbackRisk.payments || 0} payment(s) created after the update.
          </div>
        )}

        {updateMessage && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: updateMessageIsError ? "#fee2e2" : "#dcfce7",
              color: updateMessageIsError ? "#dc2626" : "#16a34a",
            }}
          >
            {updateMessage}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div
        style={{
          background: "var(--pos-brand-xlight,#fffbeb)",
          border: "1px solid var(--pos-brand-border,#fcd34d)",
          borderRadius: 12,
          padding: "16px 18px",
          fontSize: 13,
          color: "var(--pos-brand-dark,#92400e)",
          lineHeight: 1.6,
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Printer Setup</div>
        <div>
          Network printers typically use port 9100. Check your printer's network settings or
          administration panel to find its IP address.
        </div>
        <div style={{ marginTop: 6 }}>
          After entering the IP address, use the Test button to verify connectivity.
        </div>
      </div>

      {/* â”€â”€ Tables Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="pos-card pos-card-p">
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>⊞</span>
          Table Configuration
        </div>

        <div style={{ marginBottom: 20 }}>
          <label className="pos-label">Number of Tables</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              max={100}
              value={tableCount}
              onChange={(e) =>
                setTableCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
              }
              className="pos-input"
              style={{ width: 100, fontWeight: 700, fontSize: 15, textAlign: "center" }}
            />
            <span style={{ fontSize: 13, color: "var(--pos-tx-sub,#6b7280)" }}>
              tables (current: {tableCount})
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--pos-muted,#9ca3af)", marginTop: 6 }}>
            Tables with active orders will not be removed when reducing the count.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={saveTables}
            disabled={savingTables}
            className="pos-btn pos-btn-primary"
          >
            {savingTables ? "Saving..." : "Save Tables"}
          </button>
          {tableStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: tableStatus.includes("✓") ? "#dcfce7" : "#fee2e2",
                color: tableStatus.includes("✓") ? "#16a34a" : "#dc2626",
              }}
            >
              {tableStatus}
            </div>
          )}
        </div>
      </div>

      {/* ── Categories Section ─────────────────────────────────────────── */}
      <div className="pos-card pos-card-p" style={{ marginTop: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>🏷</span>
          Menu Categories
        </div>

        <p
          style={{
            fontSize: 13,
            color: "var(--pos-tx-sub,#6b7280)",
            marginBottom: 16,
            marginTop: 0,
          }}
        >
          These categories appear as dropdown options when adding or editing menu items.
        </p>

        {/* Add new category */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            className="pos-input"
            placeholder="e.g. Starters, Mains, Beverages…"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
            style={{ flex: 1 }}
          />
          <button
            onClick={addCategory}
            disabled={!normalizeCategoryName(newCategory)}
            className="pos-btn pos-btn-primary"
          >
            + Add
          </button>
        </div>

        {/* Category list */}
        {categories.length === 0 ? (
          <div style={{ fontSize: 13, color: "#d1d5db", padding: "12px 0" }}>
            No categories yet — add one above.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {categories.map((cat) => (
              <div
                key={cat}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px 5px 14px",
                  borderRadius: 20,
                  background: "#fffbeb",
                  border: "1.5px solid #fcd34d",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#92400e",
                }}
              >
                {cat}
                <button
                  onClick={() => removeCategory(cat)}
                  title={`Remove "${cat}"`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#d97706",
                    fontSize: 15,
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 4,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Save footer */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
          }}
        >
          <button
            onClick={saveCategories}
            disabled={savingCategories}
            className="pos-btn pos-btn-primary"
          >
            {savingCategories ? "Saving…" : "Save Categories"}
          </button>
          {categoryStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: categoryStatus.includes("\u2713") ? "#dcfce7" : "#fee2e2",
                color: categoryStatus.includes("\u2713") ? "#16a34a" : "#dc2626",
              }}
            >
              {categoryStatus}
            </div>
          )}
        </div>
      </div>

      {/* ── Menu Variant Options Section ───────────────────────────────── */}
      <div className="pos-card pos-card-p" style={{ marginTop: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>📏</span>
          Menu Variant Options
        </div>

        <p
          style={{
            fontSize: 13,
            color: "var(--pos-tx-sub,#6b7280)",
            marginBottom: 16,
            marginTop: 0,
          }}
        >
          These options appear in menu variant dropdowns (for example: Half, Full, Quarter).
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            className="pos-input"
            placeholder="e.g. Half, Full, Family Pack…"
            value={newMenuVariantOption}
            onChange={(e) => setNewMenuVariantOption(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMenuVariantOption()}
            style={{ flex: 1 }}
          />
          <button
            onClick={addMenuVariantOption}
            disabled={!normalizeCategoryName(newMenuVariantOption)}
            className="pos-btn pos-btn-primary"
          >
            + Add
          </button>
        </div>

        {menuVariantOptions.length === 0 ? (
          <div style={{ fontSize: 13, color: "#d1d5db", padding: "12px 0" }}>
            No variant options yet — add one above.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {menuVariantOptions.map((option) => (
              <div
                key={option}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px 5px 14px",
                  borderRadius: 20,
                  background: "#ecfeff",
                  border: "1.5px solid #67e8f9",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#155e75",
                }}
              >
                {option}
                <button
                  onClick={() => removeMenuVariantOption(option)}
                  title={`Remove "${option}"`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#0e7490",
                    fontSize: 15,
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 4,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
          }}
        >
          <button
            onClick={saveMenuVariantOptions}
            disabled={savingMenuVariantOptions}
            className="pos-btn pos-btn-primary"
          >
            {savingMenuVariantOptions ? "Saving…" : "Save Variant Options"}
          </button>
          {menuVariantStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: menuVariantStatus.includes("✓") ? "#dcfce7" : "#fee2e2",
                color: menuVariantStatus.includes("✓") ? "#16a34a" : "#dc2626",
              }}
            >
              {menuVariantStatus}
            </div>
          )}
        </div>
      </div>

      {/* Attendance Shift Master Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>⏱</span>
          Attendance Shift Master
        </div>

        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
          Configure standard working hours for each shift. Attendance overtime is computed using
          these values.
        </p>

        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {attendanceShifts.map((shift) => (
            <div
              key={shift.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(160px, 1fr) 120px auto",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pos-tx,#111827)" }}>
                {shift.label}
              </div>
              <input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={shift.hours}
                onChange={(e) => setShiftHours(shift.id, Number(e.target.value) || 0)}
                className="pos-input"
                aria-label={`${shift.label} hours`}
              />
              <span style={{ fontSize: 12, color: "var(--pos-tx-sub,#6b7280)" }}>hours</span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
          }}
        >
          <button
            onClick={saveShiftConfig}
            disabled={savingShifts}
            className="pos-btn pos-btn-primary"
          >
            {savingShifts ? "Saving..." : "Save Shift Master"}
          </button>
          {shiftStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: shiftStatus.includes("✓") ? "#dcfce7" : "#fee2e2",
                color: shiftStatus.includes("✓") ? "#16a34a" : "#dc2626",
              }}
            >
              {shiftStatus}
            </div>
          )}
        </div>
      </div>

      {/* Audit Retention Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>🗒</span>
          Audit Log Retention
        </div>

        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
          Audit records older than the selected period are <strong>permanently deleted</strong> each
          time the app starts. Choose <em>Never</em> to keep all records indefinitely.
        </p>

        <div style={{ marginBottom: 20 }}>
          <label className="pos-label">Delete audits older than</label>
          <select
            className="pos-input"
            style={{ width: 200 }}
            value={retentionDays === null ? "never" : String(retentionDays)}
            onChange={(e) =>
              setRetentionDays(e.target.value === "never" ? null : Number(e.target.value))
            }
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days (default)</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
            <option value="never">Never (keep forever)</option>
          </select>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
          }}
        >
          <button
            onClick={saveAuditConfig}
            disabled={savingAudit}
            className="pos-btn pos-btn-primary"
          >
            {savingAudit ? "Saving…" : "Save Retention Policy"}
          </button>
          {auditStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: auditStatus.includes("\u2713") ? "#dcfce7" : "#fee2e2",
                color: auditStatus.includes("\u2713") ? "#16a34a" : "#dc2626",
              }}
            >
              {auditStatus}
            </div>
          )}
        </div>
      </div>

      {/* Order History Retention Section */}
      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,#9ca3af)",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>◷</span>
          Order History Retention
        </div>

        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
          Paid orders older than the selected period are <strong>permanently deleted</strong> each
          time the app starts. Choose <em>Never</em> to keep all order history indefinitely.
        </p>

        <div style={{ marginBottom: 20 }}>
          <label className="pos-label">Delete paid orders older than</label>
          <select
            className="pos-input"
            style={{ width: 200 }}
            value={historyRetentionDays === null ? "never" : String(historyRetentionDays)}
            onChange={(e) =>
              setHistoryRetentionDays(e.target.value === "never" ? null : Number(e.target.value))
            }
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
            <option value="never">Never (keep forever)</option>
          </select>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,#e5e7eb)",
          }}
        >
          <button
            onClick={saveHistoryConfig}
            disabled={savingHistory}
            className="pos-btn pos-btn-primary"
          >
            {savingHistory ? "Saving\u2026" : "Save Retention Policy"}
          </button>
          {historyStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: historyStatus.includes("\u2713") ? "#dcfce7" : "#fee2e2",
                color: historyStatus.includes("\u2713") ? "#16a34a" : "#dc2626",
              }}
            >
              {historyStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
