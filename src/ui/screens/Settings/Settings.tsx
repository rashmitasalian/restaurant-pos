import React from "react";
import { ENV } from "../../../config/env";
import { AuthContext } from "../../context/AuthContext";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Icon } from "../../components/ui/Icon";
import { Clock3, LayoutGrid, Timer, X } from "lucide-react";
import {
  getConfigPrinters,
  setConfigPrinters,
  getConfigTables,
  getConfigCategories,
  getConfigMenuVariantOptions,
  setConfigCategories,
  setConfigMenuVariantOptions,
  getConfigAudit,
  setConfigAudit,
  getConfigHistory,
  setConfigHistory,
  getConfigShifts,
  getConfigHolidays,
  setConfigHolidays,
  setConfigShifts,
  regenerateRecoveryCodes,
  getConfigGst,
  setConfigGst,
  getConfigBranding,
  setConfigBranding,
  getConfigServiceModes,
  setConfigServiceModes,
  getSeatingAreas,
  getTables,
  setTableArea,
  setTableSeats,
  setTableName,
  applyFloorLayout,
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
  type SeatingAreaDoc,
  type TableDoc,
  type AttendanceShiftConfig,
  type PrintJobDoc,
} from "../../../app/db/posRepository";
import { DEFAULT_GST_CONFIG, isValidGstin, normalizeGstConfig } from "../../../shared/gst";
import { RECOVERY_CODE_COUNT } from "../../../shared/auth";
import { normalizeCategoryName, validationMessage } from "../../../shared/validation";
import { reportClientError } from "../../../app/utils/clientError";
import { getDefaultServiceModes, type ServiceMode } from "../../../shared/serviceModes";
import {
  FLOOR_LAYOUT_LIMITS,
  inferNamingFromTables,
  planTablesFromAreas,
  suggestPrefixFromAreaName,
  type TableNamingMode,
} from "../../../shared/floorLayout";
import { processRestaurantLogoFile, type ReceiptLogoRaster } from "../../utils/logoProcessing";
import { BackupSettingsSection } from "./BackupSettingsSection";
import {
  addSeatingAreaDraft,
  computeTableAreaUpdates,
  computeTableSeatsUpdates,
  moveSeatingAreaByDirection,
  reorderSeatingAreasByDrag,
} from "./seatingAreaUtils";

type AreaLayoutDraft = SeatingAreaDoc & {
  tableCount: number;
  namingMode: TableNamingMode;
  prefix: string;
  defaultSeats: number;
};

type PreviewOverride = { name: string; seats: number };

function previewKey(areaId: string, plannedName: string) {
  return `${areaId}::${plannedName}`;
}

function isTableStatusSuccess(status: string | null) {
  if (!status) {
    return false;
  }
  return /saved|deleted/i.test(status) && !/could not|must|keep|required|exceed|open orders/i.test(status);
}

const DEFAULT_ATTENDANCE_SHIFTS: AttendanceShiftConfig[] = [
  { id: "morning", label: "Morning", hours: 8 },
  { id: "evening", label: "Evening", hours: 8 },
  { id: "night", label: "Night", hours: 8 },
];

function mergeShiftConfig(input: AttendanceShiftConfig[]) {
  const map = new Map(
    (Array.isArray(input) ? input : [])
      .filter((entry) => entry.id && !["half-day", "half"].includes(entry.id.toLowerCase()))
      .map((entry) => [entry.id.toLowerCase(), entry]),
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

export default function Settings({
  embedded = false,
  focusSection = "identity",
}: {
  embedded?: boolean;
  focusSection?: string;
} = {}) {
  const auth = React.useContext(AuthContext);
  const sectionVisible = React.useCallback(
    (section: string) => !embedded || focusSection === section,
    [embedded, focusSection],
  );
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
  const [settingsConfirm, setSettingsConfirm] = React.useState<
    | { kind: "restore-backup" }
    | { kind: "launch-update" }
    | { kind: "prepare-with-activity"; activity: any }
    | { kind: "rollback"; risk: any }
    | null
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

  const [creditEnabled, setCreditEnabled] = React.useState(false);
  const [creditDefaultDays, setCreditDefaultDays] = React.useState(15);
  const [creditStatus, setCreditStatus] = React.useState<string | null>(null);
  const [savingCredit, setSavingCredit] = React.useState(false);

  // ── Tables / floor layout config ───────────────────────────────────────────
  const [seatingAreas, setSeatingAreas] = React.useState<AreaLayoutDraft[]>([]);
  const [newSeatingAreaName, setNewSeatingAreaName] = React.useState("");
  const [tableDocs, setTableDocs] = React.useState<TableDoc[]>([]);
  const [tableAreaDraft, setTableAreaDraft] = React.useState<Record<number, string>>({});
  const [tableSeatsDraft, setTableSeatsDraft] = React.useState<Record<number, number>>({});
  const [tableNameDraft, setTableNameDraft] = React.useState<Record<number, string>>({});
  const [previewOverrides, setPreviewOverrides] = React.useState<Record<string, PreviewOverride>>({});
  const [showAdvancedMapping, setShowAdvancedMapping] = React.useState(false);
  const [tableStatus, setTableStatus] = React.useState<string | null>(null);
  const [savingTables, setSavingTables] = React.useState(false);
  const [savingAdvancedTables, setSavingAdvancedTables] = React.useState(false);
  const [dragAreaId, setDragAreaId] = React.useState<string | null>(null);
  const [serviceModes, setServiceModes] = React.useState<ServiceMode[]>(() =>
    getDefaultServiceModes(),
  );
  const [serviceModeStatus, setServiceModeStatus] = React.useState<string | null>(null);
  const [savingServiceModes, setSavingServiceModes] = React.useState(false);

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
  const [attendanceHolidays, setAttendanceHolidays] = React.useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = React.useState("");
  const [holidayStatus, setHolidayStatus] = React.useState<string | null>(null);
  const [savingHolidays, setSavingHolidays] = React.useState(false);

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
      setPrintQueueStatus(reportClientError("settings.print-queue.load", e, "Could not load print queue"));
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
      setBackupStatus(reportClientError("settings.backup.load", e, "Could not load backups"));
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
      setUpdateMessage(reportClientError("settings.update.load", e, "Could not load update details"));
    }
  }, []);

  React.useEffect(() => {
    if (!sectionVisible("identity")) {
      return;
    }
    (async () => {
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
      try {
        const creditCfg = await window.pos?.settings?.get?.("config:credit");
        setCreditEnabled(Boolean(creditCfg?.enabled));
        setCreditDefaultDays(
          Number.isFinite(Number(creditCfg?.defaultCreditDays))
            ? Math.max(0, Math.round(Number(creditCfg?.defaultCreditDays)))
            : 15,
        );
      } catch (e) {}
    })();
  }, [sectionVisible]);

  React.useEffect(() => {
    if (!sectionVisible("hardware")) {
      return;
    }
    (async () => {
      try {
        const cfg = await getConfigPrinters();
        if (cfg) {
          setKitchenIp(cfg.kitchenPrinterIp || "");
          setCounterIp(cfg.counterPrinterIp || "");
          setPort(cfg.printerPort || 9100);
        }
      } catch (e) {}
      await loadPrintQueue();
      await loadBackups();
      await loadUpdateSupport();
    })();
  }, [sectionVisible, loadBackups, loadPrintQueue, loadUpdateSupport]);

  React.useEffect(() => {
    if (!sectionVisible("operations")) {
      return;
    }
    (async () => {
      try {
        const [tCfg, areas, tables] = await Promise.all([
          getConfigTables().catch(() => null),
          getSeatingAreas(true),
          getTables(),
        ]);
        const layoutById = new Map(
          (Array.isArray(tCfg?.layout) ? tCfg.layout : []).map((entry) => [entry.id, entry]),
        );
        const mappedAreas: AreaLayoutDraft[] =
          areas && areas.length
            ? [...areas]
                .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
                .map((area) => {
                  const areaTables = (tables || []).filter(
                    (table) => String(table.areaId || "") === area.id,
                  );
                  const saved = layoutById.get(area.id);
                  const inferred = inferNamingFromTables(
                    areaTables.map((table) => String(table.name || "")),
                  );
                  const seats =
                    Math.trunc(
                      Number(saved?.defaultSeats || tCfg?.defaultSeats || areaTables[0]?.seats || 4),
                    ) || 4;
                  return {
                    ...area,
                    tableCount: Math.max(
                      0,
                      Math.trunc(Number(saved?.tableCount ?? areaTables.length) || 0),
                    ),
                    namingMode:
                      saved?.namingMode === "prefix" || saved?.namingMode === "number"
                        ? saved.namingMode
                        : inferred.namingMode,
                    prefix: String(saved?.prefix ?? inferred.prefix ?? ""),
                    defaultSeats: Math.max(1, Math.min(FLOOR_LAYOUT_LIMITS.MAX_SEATS, seats)),
                  };
                })
            : [
                {
                  _id: "seating-area:area:main",
                  type: "seating-area",
                  id: "area:main",
                  name: "Main Dining",
                  order: 1,
                  active: true,
                  tableCount: 0,
                  namingMode: "number",
                  prefix: "",
                  defaultSeats: 4,
                },
              ];
        setSeatingAreas(mappedAreas);
        setTableDocs(tables || []);
        setPreviewOverrides({});
        const assignment: Record<number, string> = {};
        const seatsDraft: Record<number, number> = {};
        const nameDraft: Record<number, string> = {};
        for (const table of tables || []) {
          assignment[table.id] = String(table.areaId || mappedAreas[0]?.id || "area:main");
          seatsDraft[table.id] = Math.max(1, Math.min(50, Number(table.seats) || 4));
          nameDraft[table.id] = String(table.name || table.id);
        }
        setTableAreaDraft(assignment);
        setTableSeatsDraft(seatsDraft);
        setTableNameDraft(nameDraft);
      } catch (e) {}
      try {
        const modeCfg = await getConfigServiceModes();
        setServiceModes(
          Array.isArray(modeCfg?.modes) && modeCfg.modes.length
            ? modeCfg.modes
            : getDefaultServiceModes(),
        );
      } catch (e) {}
      try {
        setCategories(await getConfigCategories());
      } catch (e) {}
      try {
        setMenuVariantOptions(await getConfigMenuVariantOptions());
      } catch (e) {}
      try {
        const shifts = await getConfigShifts();
        setAttendanceShifts(mergeShiftConfig(shifts));
      } catch (e) {}
      try {
        setAttendanceHolidays(await getConfigHolidays());
      } catch (e) {}
    })();
  }, [sectionVisible]);

  React.useEffect(() => {
    if (!sectionVisible("retention")) {
      return;
    }
    (async () => {
      try {
        const auditCfg = await getConfigAudit();
        setRetentionDays(auditCfg.retentionDays);
      } catch (e) {}
      try {
        const historyCfg = await getConfigHistory();
        setHistoryRetentionDays(historyCfg.retentionDays);
      } catch (e) {}
    })();
  }, [sectionVisible]);

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
      setStatus("Saved successfully ");
      setTimeout(() => setStatus(null), 3000);
    } catch (e: any) {
      setStatus(reportClientError("settings.printers.save", e, "Could not save printer settings"));
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
      setBrandingStatus(reportClientError("settings.branding.logo", e, "Could not process logo"));
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
      setBrandingStatus(reportClientError("settings.branding.save", e, "Could not save branding"));
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
      setGstStatus(reportClientError("settings.gst.save", e, "Could not save GST settings"));
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
      setPrintQueueStatus(reportClientError("settings.print-queue.retry", e, "Could not retry print job"));
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
      setPrintQueueStatus(reportClientError("settings.print-queue.cleanup", e, "Could not clean up print jobs"));
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
      setBackupStatus(reportClientError("settings.backup.create", e, "Could not create backup"));
    } finally {
      endAction("backup.create");
      setBackupBusy(null);
    }
  };

  const restoreBackup = () => {
    if (!beginAction("backup.restore")) {
      return;
    }
    endAction("backup.restore");
    setSettingsConfirm({ kind: "restore-backup" });
  };

  const confirmRestoreBackup = async () => {
    setSettingsConfirm(null);
    if (!beginAction("backup.restore")) {
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
      setBackupStatus(reportClientError("settings.backup.restore", e, "Could not restore backup"));
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
      setUpdateMessage(reportClientError("settings.update.check", e, "Could not check for updates"));
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
        setSettingsConfirm({ kind: "prepare-with-activity", activity: result.businessActivity });
        setUpdateMessage("Business activity detected. Confirm to continue preparing the update.");
        return;
      }
      await loadUpdateSupport();
      setUpdateMessage("Update prepared. Backup and installers are verified.");
    } catch (e: any) {
      setUpdateMessage(reportClientError("settings.update.prepare", e, "Could not prepare update"));
    } finally {
      endAction("update.prepare");
      setUpdateBusy(null);
    }
  };

  const confirmPrepareWithActivity = async () => {
    setSettingsConfirm(null);
    if (!beginAction("update.prepare")) {
      return;
    }
    setUpdateBusy("prepare");
    setUpdateMessage(null);
    try {
      const result = await prepareUpdate({ allowBusinessActivity: true });
      if (result?.ok === false && result.reason === "business-activity") {
        setUpdateMessage("Update preparation cancelled.");
        return;
      }
      await loadUpdateSupport();
      setUpdateMessage("Update prepared. Backup and installers are verified.");
    } catch (e: any) {
      setUpdateMessage(reportClientError("settings.update.prepare", e, "Could not prepare update"));
    } finally {
      endAction("update.prepare");
      setUpdateBusy(null);
    }
  };

  const launchUpdate = () => {
    if (!beginAction("update.launch")) {
      return;
    }
    endAction("update.launch");
    setSettingsConfirm({ kind: "launch-update" });
  };

  const confirmLaunchUpdate = async () => {
    setSettingsConfirm(null);
    if (!beginAction("update.launch")) {
      return;
    }
    setUpdateBusy("launch");
    setUpdateMessage(null);
    try {
      await launchPreparedUpdate();
      setUpdateMessage("Installer launched. Complete the installer to finish the update.");
    } catch (e: any) {
      setUpdateMessage(reportClientError("settings.update.launch", e, "Could not launch installer"));
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
        setSettingsConfirm({ kind: "rollback", risk: first.risk || {} });
        setUpdateMessage("Review rollback impact and confirm to continue.");
        setUpdateBusy(null);
        endAction("update.rollback");
        return;
      }
      launched = true;
      setUpdateMessage("Rollback installer launched. Complete the installer to finish rollback.");
    } catch (e: any) {
      setUpdateMessage(reportClientError("settings.update.rollback", e, "Could not roll back update"));
      setUpdateBusy(null);
    } finally {
      endAction("update.rollback");
      if (!launched) {
        setUpdateBusy(null);
      }
    }
  };

  const confirmRollbackUpdate = async () => {
    setSettingsConfirm(null);
    if (!beginAction("update.rollback")) {
      return;
    }
    let launched = false;
    setUpdateBusy("rollback");
    setUpdateMessage(null);
    try {
      await rollbackLastUpdate({ confirmed: true });
      launched = true;
      setUpdateMessage("Rollback installer launched. Complete the installer to finish rollback.");
    } catch (e: any) {
      setUpdateMessage(reportClientError("settings.update.rollback", e, "Could not roll back update"));
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
      setUpdateMessage(reportClientError("settings.update.diagnostics", e, "Could not export diagnostics"));
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
        setStatus(`${printer} printer reachable `);
        setTimeout(() => setStatus(null), 3000);
      } else {
        setStatus(`${printer} failed: ${res?.error || "unknown"}`);
      }
    } catch (e: any) {
      setStatus(reportClientError("settings.printers.test", e, `${printer} test failed`));
    } finally {
      setTestingPrinter(null);
      endAction(`printer.test.${printer}`);
    }
  };

  const floorPreview = React.useMemo(() => planTablesFromAreas(seatingAreas), [seatingAreas]);

  const refreshSeatingConfig = async () => {
    const [tCfg, areas, tables] = await Promise.all([
      getConfigTables().catch(() => null),
      getSeatingAreas(true),
      getTables(),
    ]);
    const layoutById = new Map(
      (Array.isArray(tCfg?.layout) ? tCfg.layout : []).map((entry) => [entry.id, entry]),
    );
    const ordered: AreaLayoutDraft[] = [...areas]
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((area) => {
        const areaTables = (tables || []).filter((table) => String(table.areaId || "") === area.id);
        const saved = layoutById.get(area.id);
        const inferred = inferNamingFromTables(areaTables.map((table) => String(table.name || "")));
        const seats =
          Math.trunc(Number(saved?.defaultSeats || tCfg?.defaultSeats || areaTables[0]?.seats || 4)) ||
          4;
        return {
          ...area,
          tableCount: Math.max(0, Math.trunc(Number(saved?.tableCount ?? areaTables.length) || 0)),
          namingMode:
            saved?.namingMode === "prefix" || saved?.namingMode === "number"
              ? saved.namingMode
              : inferred.namingMode,
          prefix: String(saved?.prefix ?? inferred.prefix ?? ""),
          defaultSeats: Math.max(1, Math.min(FLOOR_LAYOUT_LIMITS.MAX_SEATS, seats)),
        };
      });
    setSeatingAreas(ordered);
    setTableDocs(tables || []);
    setPreviewOverrides({});
    const assignment: Record<number, string> = {};
    const seatsDraft: Record<number, number> = {};
    const nameDraft: Record<number, string> = {};
    for (const table of tables || []) {
      assignment[table.id] = String(table.areaId || ordered[0]?.id || "area:main");
      seatsDraft[table.id] = Math.max(1, Math.min(50, Number(table.seats) || 4));
      nameDraft[table.id] = String(table.name || table.id);
    }
    setTableAreaDraft(assignment);
    setTableSeatsDraft(seatsDraft);
    setTableNameDraft(nameDraft);
  };

  const saveFloorLayout = async () => {
    if (!beginAction("tables.save")) {
      return;
    }
    if (floorPreview.error) {
      endAction("tables.save");
      setTableStatus(floorPreview.error);
      return;
    }
    setSavingTables(true);
    setTableStatus(null);
    try {
      const tableOverrides = floorPreview.tables
        .map((table) => {
          const key = previewKey(table.areaId, table.name);
          const override = previewOverrides[key];
          if (!override) {
            return null;
          }
          const nameChanged = override.name.trim() && override.name.trim() !== table.name;
          const seatsChanged = Number(override.seats) !== Number(table.seats);
          if (!nameChanged && !seatsChanged) {
            return null;
          }
          return {
            areaId: table.areaId,
            plannedName: table.name,
            name: override.name.trim() || table.name,
            seats: override.seats,
          };
        })
        .filter(Boolean) as Array<{
        areaId: string;
        plannedName: string;
        name: string;
        seats: number;
      }>;

      await applyFloorLayout({
        areas: seatingAreas.map((area, index) => ({
          id: area.id,
          name: area.name,
          active: area.active !== false,
          order: index + 1,
          tableCount: area.tableCount,
          namingMode: area.namingMode,
          prefix: area.prefix,
          defaultSeats: area.defaultSeats,
        })),
        tableOverrides,
      });
      await refreshSeatingConfig();
      window.dispatchEvent(new Event("orders-changed"));
      window.dispatchEvent(new Event("seating-areas-changed"));
      setTableStatus("Saved");
      setTimeout(() => setTableStatus(null), 4000);
    } catch (e: any) {
      const message = String(e?.message || e || "");
      setTableStatus(
        reportClientError(
          "settings.tables.save",
          e,
          message.includes("tables-have-open-orders")
            ? "Cannot remove tables that still have open orders"
            : "Could not save floor layout",
        ),
      );
    } finally {
      setSavingTables(false);
      endAction("tables.save");
    }
  };

  const addSeatingArea = () => {
    const draft = addSeatingAreaDraft(seatingAreas, newSeatingAreaName);
    if (draft.error) {
      setTableStatus(draft.error);
      return;
    }
    const added = (draft.areas || []).map((area) => {
      const existing = seatingAreas.find((entry) => entry.id === area.id);
      if (existing) {
        return { ...existing, ...area };
      }
      const prefix = suggestPrefixFromAreaName(area.name || "");
      return {
        _id: `seating-area:${area.id}`,
        type: "seating-area" as const,
        id: area.id,
        name: area.name,
        order: area.order,
        active: area.active !== false,
        tableCount: 0,
        namingMode: (prefix ? "prefix" : "number") as TableNamingMode,
        prefix,
        defaultSeats: 4,
      };
    });
    setSeatingAreas(added);
    setNewSeatingAreaName("");
    setTableStatus(null);
  };

  const moveSeatingArea = (id: string, direction: -1 | 1) => {
    setSeatingAreas(
      (current) => moveSeatingAreaByDirection(current, id, direction) as AreaLayoutDraft[],
    );
  };

  const dropSeatingArea = (dropTargetId: string) => {
    if (!dragAreaId || dragAreaId === dropTargetId) {
      setDragAreaId(null);
      return;
    }
    setSeatingAreas(
      (current) =>
        reorderSeatingAreasByDrag(current, dragAreaId, dropTargetId) as AreaLayoutDraft[],
    );
    setDragAreaId(null);
  };

  const removeSeatingArea = (id: string) => {
    const target = seatingAreas.find((area) => area.id === id);
    if (!target) {
      return;
    }
    const activeRemaining = seatingAreas.filter(
      (area) => area.id !== id && area.active !== false,
    ).length;
    if (target.active !== false && activeRemaining < 1) {
      setTableStatus("Keep at least one active area");
      return;
    }
    setSeatingAreas((current) =>
      current
        .filter((area) => area.id !== id)
        .map((area, index) => ({ ...area, order: index + 1 })),
    );
    setTableStatus(null);
  };

  const saveAdvancedTableEdits = async () => {
    if (!beginAction("seatingAreas.save")) {
      return;
    }
    setSavingAdvancedTables(true);
    setTableStatus(null);
    try {
      const activeIds = new Set(
        seatingAreas.filter((area) => area.active !== false).map((area) => area.id),
      );
      const updates = computeTableAreaUpdates(tableDocs, tableAreaDraft, activeIds);
      for (const update of updates) {
        await setTableArea(update.tableId, update.areaId);
      }
      const seatUpdates = computeTableSeatsUpdates(tableDocs, tableSeatsDraft);
      for (const update of seatUpdates) {
        await setTableSeats(update.tableId, update.seats);
      }
      for (const table of tableDocs) {
        const nextName = String(tableNameDraft[table.id] || "").trim();
        if (nextName && nextName !== String(table.name || "").trim()) {
          await setTableName(table.id, nextName);
        }
      }
      await refreshSeatingConfig();
      setTableStatus("Saved");
      window.dispatchEvent(new Event("seating-areas-changed"));
      window.dispatchEvent(new Event("orders-changed"));
      setTimeout(() => setTableStatus(null), 4000);
    } catch (e: any) {
      setTableStatus(reportClientError("settings.tables.save", e, "Could not save table settings"));
    } finally {
      setSavingAdvancedTables(false);
      endAction("seatingAreas.save");
    }
  };

  const toggleServiceMode = (id: string) => {
    setServiceModes((prev) =>
      prev.map((mode) => (mode.id === id ? { ...mode, enabled: !mode.enabled } : mode)),
    );
  };

  const updateServiceModeField = <K extends keyof ServiceMode>(
    id: string,
    field: K,
    value: ServiceMode[K],
  ) => {
    setServiceModes((prev) =>
      prev.map((mode) => (mode.id === id ? { ...mode, [field]: value } : mode)),
    );
  };

  const saveServiceModes = async () => {
    if (!beginAction("serviceModes.save")) {
      return;
    }
    const orderedModes = [...serviceModes].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
    const enabledCount = orderedModes.filter((mode) => mode.enabled).length;
    if (enabledCount < 1) {
      endAction("serviceModes.save");
      setServiceModeStatus("Enable at least one service mode");
      return;
    }

    setSavingServiceModes(true);
    setServiceModeStatus(null);
    try {
      const saved = await setConfigServiceModes(orderedModes);
      setServiceModes(saved.modes || serviceModes);
      setServiceModeStatus("Saved ");
      window.dispatchEvent(new Event("service-modes-changed"));
      setTimeout(() => setServiceModeStatus(null), 4000);
    } catch (e: any) {
      setServiceModeStatus(reportClientError("settings.service-modes.save", e, "Could not save service modes"));
    } finally {
      setSavingServiceModes(false);
      endAction("serviceModes.save");
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
      setCategoryStatus(reportClientError("settings.categories.save", e, "Could not save categories"));
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
      setMenuVariantStatus("Saved ");
      setTimeout(() => setMenuVariantStatus(null), 3000);
    } catch (e: any) {
      setMenuVariantStatus(reportClientError("settings.menu-variants.save", e, "Could not save menu variants"));
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
      setAuditStatus(reportClientError("settings.audit.save", e, "Could not save audit settings"));
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
      setHistoryStatus(reportClientError("settings.history.save", e, "Could not save history settings"));
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
      const sanitized = attendanceShifts
        .filter((shift) => !["half-day", "half"].includes(shift.id.toLowerCase()))
        .map((shift) => ({
          id: shift.id,
          label: shift.label,
          hours: Math.round(shift.hours * 100) / 100,
        }));
      await setConfigShifts(sanitized);
      setAttendanceShifts(sanitized);
      setShiftStatus("Saved ");
      setTimeout(() => setShiftStatus(null), 3000);
    } catch (e: any) {
      setShiftStatus(reportClientError("settings.shifts.save", e, "Could not save shift settings"));
    }
    setSavingShifts(false);
    endAction("attendance.shifts.save");
  };

  const addHolidayDraft = () => {
    const date = holidayDraft.trim();
    if (!date) {
      return;
    }
    setAttendanceHolidays((previous) => [...new Set([...previous, date])].sort());
    setHolidayDraft("");
  };

  const saveHolidayConfig = async () => {
    if (!beginAction("attendance.holidays.save")) {
      return;
    }
    setSavingHolidays(true);
    setHolidayStatus(null);
    try {
      await setConfigHolidays(attendanceHolidays);
      setHolidayStatus("Saved ");
      setTimeout(() => setHolidayStatus(null), 3000);
    } catch (e: any) {
      setHolidayStatus(reportClientError("settings.holidays.save", e, "Could not save holiday settings"));
    }
    setSavingHolidays(false);
    endAction("attendance.holidays.save");
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
        setRecoveryStatus(reportClientError("settings.recovery-codes", e, "Could not regenerate recovery codes."));
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
      ? { background: "var(--pos-danger-tint)", color: "var(--pos-danger-text)", border: "var(--pos-danger-line)" }
      : updateStatusTone === "warning"
        ? { background: "var(--pos-saffron-tint)", color: "var(--pos-saffron-text)", border: "var(--pos-saffron-line)" }
        : updateStatusTone === "success"
          ? { background: "var(--pos-success-tint)", color: "var(--pos-success-text)", border: "var(--pos-success-line)" }
          : { background: "var(--pos-surface-hover)", color: "var(--pos-tx-sec)", border: "var(--pos-line)" };
  const updateMessageIsError = Boolean(
    updateMessage?.includes("failed") ||
    updateMessage?.includes("Could not") ||
      updateMessage?.includes("Failed"),
  );

  return (
    <div className={embedded ? undefined : "pos-page pos-page-sm"}>
      {!embedded && <PageHeader title="Settings" subtitle="Configure your POS system" />}

      {sectionVisible("identity") && (
      <>
      {auth?.session?.role === "admin" && (
        <div
          className="pos-card pos-card-p"
          style={{ marginBottom: 24 }}
          data-settings-sec="identity"
          id="settings-sec-identity"
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--pos-muted,var(--pos-tx-muted))",
              marginBottom: 14,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Admin Recovery Codes
          </div>

          <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", margin: "0 0 16px", lineHeight: 1.6 }}>
            Regenerating creates {RECOVERY_CODE_COUNT} new one-time codes and invalidates all
            unused recovery codes for your admin account. New codes are shown only once.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Input
              type="password"
              label="Current admin password"
              labelHidden
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              placeholder="Current admin password"
              autoComplete="current-password"
              style={{ maxWidth: 260 }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={regenerateAdminRecoveryCodes}
              disabled={regeneratingRecovery}
            >
              {regeneratingRecovery ? "Regenerating..." : `Regenerate ${RECOVERY_CODE_COUNT} Codes`}
            </Button>
          </div>

          {recoveryStatus && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: recoveryStatus.includes("created") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: recoveryStatus.includes("created") ? "var(--pos-success)" : "var(--pos-danger)",
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
                border: "1px solid var(--pos-line)",
                background: "var(--pos-surface-hover)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pos-tx)", marginBottom: 10 }}>
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
                      background: "var(--pos-surface)",
                      border: "1px solid var(--pos-line)",
                      borderRadius: 7,
                      fontSize: 13,
                      color: "var(--pos-tx)",
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
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="identity"
        id={auth?.session?.role === "admin" ? undefined : "settings-sec-identity"}
      >
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
          Business Identity
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Input
            label="Hotel Name"
            value={hotelName}
            onChange={(event) => setHotelName(event.target.value)}
            placeholder="Restaurant name"
          />
          <Input
            label="Initials"
            value={hotelInitials}
            onChange={(event) => setHotelInitials(event.target.value.toUpperCase())}
            placeholder="POS"
            maxLength={4}
            style={{ maxWidth: 120 }}
          />
          <Input
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={hotelPhone}
            onChange={(event) => setHotelPhone(event.target.value)}
            placeholder="Receipt phone"
          />
          <Input
            label="Email"
            value={hotelEmail}
            onChange={(event) => setHotelEmail(event.target.value)}
            placeholder="Receipt email"
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <Input
              label="Tagline"
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
                border: "1px solid var(--pos-border,var(--pos-line))",
                borderRadius: 10,
                background: "var(--pos-surface-sunken)",
              }}
            >
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 12,
                  border: "1px solid var(--pos-line)",
                  background: "var(--pos-surface)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  color: "var(--pos-tx-muted)",
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
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    style={{ cursor: processingLogo ? "not-allowed" : "pointer", opacity: processingLogo ? 0.65 : 1 }}
                  >
                    {processingLogo ? "Processing..." : hotelLogoDataUrl ? "Replace Logo" : "Upload Logo"}
                  </label>
                  {hotelLogoDataUrl && (
                    <Button type="button" variant="secondary" size="sm" onClick={removeLogo}>
                      Remove Logo
                    </Button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginTop: 8, lineHeight: 1.5 }}>
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
            flexWrap: "wrap",
          }}
        >
          <Button
            type="button"
            variant="primary"
            onClick={saveBranding}
            disabled={savingBranding || processingLogo}
          >
            {savingBranding ? "Saving..." : "Save Business Identity"}
          </Button>
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
                    ? "var(--pos-success-tint)"
                    : "var(--pos-danger-tint)",
                color:
                  brandingStatus.includes("saved") ||
                  brandingStatus.includes("ready") ||
                  brandingStatus.includes("removed")
                    ? "var(--pos-success)"
                    : "var(--pos-danger)",
              }}
            >
              {brandingStatus}
            </div>
          )}
        </div>
      </div>

      {/* GST Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="identity"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
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
            border: "1px solid var(--pos-border,var(--pos-line))",
            borderRadius: 10,
            background: gstEnabled ? "var(--pos-success-tint)" : "var(--pos-surface-hover)",
            marginBottom: 18,
            cursor: "pointer",
          }}
        >
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--pos-tx)" }}>
              Print GST registration details on bills
            </span>
            <span style={{ display: "block", fontSize: 12, color: "var(--pos-tx-sub)", marginTop: 2 }}>
              GST is still calculated when this is off; only GSTIN/legal details are hidden.
            </span>
          </span>
          <input
            type="checkbox"
            checked={gstEnabled}
            onChange={(event) => setGstEnabled(event.target.checked)}
            style={{ width: 18, height: 18, accentColor: "var(--pos-success)", flexShrink: 0 }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Input
            label="GSTIN"
            value={gstin}
            onChange={(event) => setGstin(event.target.value.toUpperCase())}
            placeholder="22AAAAA0000A1Z5"
            maxLength={15}
            style={{ fontFamily: "monospace", textTransform: "uppercase" }}
          />
          <Input
            label="GST Rate (%)"
            type="number"
            min={0}
            max={28}
            step={0.01}
            value={gstRate}
            onChange={(event) => setGstRate(Number(event.target.value))}
            style={{ width: 140 }}
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <Input
              label="Legal Business Name"
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
          <Input
            label="State Code"
            value={gstStateCode}
            onChange={(event) => setGstStateCode(event.target.value)}
            placeholder="e.g. 27"
            maxLength={2}
            style={{ width: 120 }}
          />
          <Input
            label="State Name"
            value={gstStateName}
            onChange={(event) => setGstStateName(event.target.value)}
            placeholder="e.g. Maharashtra"
          />
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 16,
            fontSize: 13,
            color: "var(--pos-tx-sec)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={gstPriceIncludesTax}
            onChange={(event) => setGstPriceIncludesTax(event.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--pos-teal)" }}
          />
          <span>
            Menu prices include GST
            <span style={{ display: "block", fontSize: 12, color: "var(--pos-tx-sub)", fontWeight: 500, marginTop: 2 }}>
              Recommended for Indian restaurants: menu shows the amount guests pay; the bill breaks out taxable value + CGST/SGST.
              Turn off only if menu rates are tax-exclusive and GST should be added on top.
            </span>
          </span>
        </label>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 16,
            marginTop: 18,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
            flexWrap: "wrap",
          }}
        >
          <Button
            type="button"
            onClick={saveGstConfig}
            disabled={savingGst}
            variant="primary"
          >
            {savingGst ? "Saving..." : "Save GST Details"}
          </Button>
          <Button
            type="button"
            variant="secondary"
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
          >
            Reset Form
          </Button>
          {gstStatus && (
            <div
              style={{
                marginLeft: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: gstStatus.includes("saved") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: gstStatus.includes("saved") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {gstStatus}
            </div>
          )}
        </div>
      </div>

      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="identity"
      >
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
          Customer Credit
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--pos-tx-sub)" }}>
          Allow trusted customers to pay later from Billing. Restaurant default days apply to new
          bills only — existing bills keep the due date they were saved with. Per-customer days and
          limits can be set on the customer account.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "12px 14px",
            border: "1px solid var(--pos-border,var(--pos-line))",
            borderRadius: 10,
            background: creditEnabled ? "var(--pos-success-tint)" : "var(--pos-surface-hover)",
            marginBottom: 14,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14 }}>Enable customer credit</span>
          <input
            type="checkbox"
            checked={creditEnabled}
            onChange={(e) => setCreditEnabled(e.target.checked)}
          />
        </label>
        <label className="pos-label">Restaurant default credit days</label>
        <input
          type="number"
          min={0}
          max={365}
          value={creditDefaultDays}
          onChange={(e) => setCreditDefaultDays(Number(e.target.value || 0))}
          className="pos-input"
          style={{ maxWidth: 160, marginBottom: 6 }}
        />
        <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginBottom: 14 }}>
          Used when a customer has no own due days. Applies to new credit bills only.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="primary"
            disabled={savingCredit}
            onClick={async () => {
              if (!beginAction("credit.save")) {
                return;
              }
              setSavingCredit(true);
              setCreditStatus(null);
              try {
                await window.pos!.settings!.set("config:credit", {
                  enabled: creditEnabled,
                  defaultCreditDays: creditDefaultDays,
                });
                setCreditStatus("Credit settings saved");
                setTimeout(() => setCreditStatus(null), 3000);
              } catch (e: any) {
                setCreditStatus(
                  reportClientError("settings.credit.save", e, "Could not save credit settings"),
                );
              } finally {
                endAction("credit.save");
                setSavingCredit(false);
              }
            }}
          >
            {savingCredit ? "Saving..." : "Save Credit Settings"}
          </Button>
          {creditStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: creditStatus.includes("saved")
                  ? "var(--pos-success-tint)"
                  : "var(--pos-danger-tint)",
                color: creditStatus.includes("saved") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {creditStatus}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {sectionVisible("hardware") && (
      <>
      {/* Printers Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="hardware"
        id="settings-sec-hardware"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}></span>
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
            <Button
              variant="accent"
              onClick={() => doTestPrint("kitchen")}
              title="Test configured printer or default printer"
              disabled={testingPrinter !== null}
            >
              {testingPrinter === "kitchen" ? "Testing..." : "Test"}
            </Button>
          </div>
        </div>

        {/* Counter Printer */}
        <div style={{ marginBottom: 24 }}>
          <label className="pos-label">Counter / Receipt Printer</label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="text"
              value={counterIp}
              onChange={(e) => setCounterIp(e.target.value)}
              placeholder="Leave blank to use kitchen printer"
              className="pos-input"
              style={{ fontFamily: "monospace" }}
            />
            <Button
              variant="accent"
              onClick={() => doTestPrint("counter")}
              title="Test configured printer or default printer"
              disabled={testingPrinter !== null}
            >
              {testingPrinter === "counter" ? "Testing..." : "Test"}
            </Button>
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
          <p style={{ fontSize: 12, color: "var(--pos-muted)", marginTop: 6 }}>
            Default: 9100 (for network printers)
          </p>
        </div>

        <div
          style={{
            marginBottom: 20,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid var(--pos-saffron-line)",
            background: "var(--pos-saffron-tint)",
            fontSize: 13,
            color: "var(--pos-saffron-text)",
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Printer Setup</div>
          <div>
            Network printers typically use port 9100. Check your printer&apos;s network settings or
            administration panel to find its IP address.
          </div>
          <div style={{ marginTop: 6 }}>
            After entering the IP address, use the Test button to verify connectivity.
          </div>
          <div style={{ marginTop: 6 }}>
            Single-printer setup: enter the printer only under Kitchen and leave Counter blank.
            Self Service will print one bill and one KOT instead of duplicating the KOT.
          </div>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 16,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
            flexWrap: "wrap",
          }}
        >
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setKitchenIp("");
              setCounterIp("");
              setPort(9100);
              setStatus(null);
            }}
          >
            Reset
          </Button>

          {status && (
            <div
              style={{
                marginLeft: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: status.includes("")
                  ? "var(--pos-success-tint)"
                  : status.includes("failed") || status.includes("Failed")
                    ? "var(--pos-danger-tint)"
                    : "var(--pos-saffron-tint)",
                color: status.includes("")
                  ? "var(--pos-success)"
                  : status.includes("failed") || status.includes("Failed")
                    ? "var(--pos-danger)"
                    : "var(--pos-saffron-text)",
              }}
            >
              {status}
            </div>
          )}
        </div>
      </div>

      {/* Print Queue Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="hardware"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
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
          <Button
            type="button"
            onClick={loadPrintQueue}
            disabled={loadingPrintQueue}
            
            style={{ padding: "6px 10px", fontSize: 12 }}
           variant="secondary">
            {loadingPrintQueue ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {visiblePrintJobs.length === 0 ? (
          <div
            style={{
              padding: "14px 0",
              color: "var(--pos-tx-sub)",
              fontSize: 13,
              borderTop: "1px solid var(--pos-border,var(--pos-line))",
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
                  border: "1px solid var(--pos-border,var(--pos-line))",
                  borderRadius: 8,
                  background: job.status === "failed" ? "var(--pos-saffron-tint)" : "var(--pos-surface-hover)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pos-tx)" }}>
                    {job.jobType.toUpperCase()} to {job.printerName || "default"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginTop: 3 }}>
                    {job.status} - attempts {job.retryCount}/{job.maxRetries} - {formatDateTime(job.createdAt)}
                  </div>
                  {job.error && (
                    <div style={{ fontSize: 12, color: "var(--pos-saffron-text)", marginTop: 4 }}>
                      {job.error}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => retryQueuedPrint(job._id)}
                  disabled={retryingPrintJob === job._id}
                >
                  {retryingPrintJob === job._id ? "Retrying..." : "Retry"}
                </Button>
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
            flexWrap: "wrap",
          }}
        >
          <Button
            type="button"
            onClick={clearCompletedPrintJobs}
            disabled={clearingPrintJobs || loadingPrintQueue}
            variant="secondary"
          >
            {clearingPrintJobs ? "Clearing..." : "Clear Old Jobs"}
          </Button>
          {printQueueStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: printQueueStatus.includes("failed") || printQueueStatus.includes("Could not") || printQueueStatus.includes("Cleanup")
                  ? "var(--pos-danger-tint)"
                  : "var(--pos-success-tint)",
                color: printQueueStatus.includes("failed") || printQueueStatus.includes("Could not") || printQueueStatus.includes("Cleanup")
                  ? "var(--pos-danger)"
                  : "var(--pos-success)",
              }}
            >
              {printQueueStatus}
            </div>
          )}
        </div>
      </div>

      {/* Backup Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="hardware"
      >
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
          SQLite File Export
        </div>

        <div style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 12 }}>
          Export or restore a plain SQLite file. For automatic encrypted backups, use Settings → Backup.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            type="button"
            onClick={createBackup}
            disabled={backupBusy !== null}
            variant="primary"
          >
            {backupBusy === "create" ? "Exporting..." : "Export Database File"}
          </Button>
          <Button
            type="button"
            onClick={restoreBackup}
            disabled={backupBusy !== null}
            variant="secondary"
          >
            {backupBusy === "restore" ? "Restoring..." : "Restore From File"}
          </Button>
          <Button
            type="button"
            onClick={loadBackups}
            disabled={backupBusy !== null}
            variant="secondary"
          >
            Refresh List
          </Button>
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
            fontSize: 13,
            color: "var(--pos-tx-sub)",
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
                ? "var(--pos-danger-tint)"
                : "var(--pos-success-tint)",
              color: backupStatus.includes("failed") || backupStatus.includes("Could not")
                ? "var(--pos-danger)"
                : "var(--pos-success)",
            }}
          >
            {backupStatus}
          </div>
        )}
      </div>

      {/* Update & Support Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="hardware"
      >
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
          Update & Support
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 16,
            fontSize: 13,
            color: "var(--pos-tx-sec)",
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

        <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginBottom: 14 }}>
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
              border: "1px solid var(--pos-border,var(--pos-line))",
              background: "var(--pos-surface-hover)",
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
          <Button
            type="button"
            onClick={checkUpdate}
            disabled={updateBusy !== null}
            variant="secondary"
          >
            {updateBusy === "check" ? "Checking..." : "Check for Updates"}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => preparePosUpdate(false)}
            disabled={updateBusy !== null || !updateCheck?.updateAvailable}
          >
            {updateBusy === "prepare" ? "Preparing..." : "Prepare Update"}
          </Button>
          <Button
            type="button"
            onClick={launchUpdate}
            disabled={updateBusy !== null || updateStatus?.state?.status !== "prepared"}
            variant="primary"
          >
            Launch Installer
          </Button>
          <Button
            type="button"
            onClick={rollbackUpdate}
            disabled={updateBusy !== null || !updateStatus?.rollbackAvailable}
            variant="secondary"
          >
            {updateBusy === "rollback" ? "Rolling back..." : "Roll Back Last Update"}
          </Button>
          <Button
            type="button"
            onClick={exportSupportDiagnostics}
            disabled={updateBusy !== null}
            variant="secondary"
          >
            {updateBusy === "diagnostics" ? "Exporting..." : "Export Diagnostics"}
          </Button>
        </div>

        {updateStatus?.rollbackRisk && updateStatus.rollbackAvailable && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--pos-saffron-text)" }}>
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
              background: updateMessageIsError ? "var(--pos-danger-tint)" : "var(--pos-success-tint)",
              color: updateMessageIsError ? "var(--pos-danger)" : "var(--pos-success)",
            }}
          >
            {updateMessage}
          </div>
        )}
      </div>
      </>
      )}

      {sectionVisible("backup") && <BackupSettingsSection />}

      {sectionVisible("operations") && (
      <>
      {/* ── Tables Section ─────────────────────────────────────────────── */}
      <div
        className="pos-card pos-card-p"
        data-settings-sec="operations"
        id="settings-sec-operations"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 12,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon icon={LayoutGrid} size="sm" />
          Table Configuration
        </div>
        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginTop: 0, marginBottom: 18 }}>
          Set up seating areas first, then tables per area. One Save creates names and assignments.
        </p>

        <label className="pos-label">Seating Areas</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input
            className="pos-input"
            value={newSeatingAreaName}
            onChange={(event) => setNewSeatingAreaName(event.target.value)}
            placeholder="Garden, Ground Floor, First Floor, Bar..."
            style={{ maxWidth: 320 }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSeatingArea();
              }
            }}
          />
          <Button type="button" onClick={addSeatingArea} variant="secondary">
            Add Area
          </Button>
          {tableStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                alignSelf: "center",
                background: isTableStatusSuccess(tableStatus)
                  ? "var(--pos-success-tint)"
                  : "var(--pos-danger-tint)",
                color: isTableStatusSuccess(tableStatus)
                  ? "var(--pos-success)"
                  : "var(--pos-danger)",
              }}
            >
              {tableStatus}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {seatingAreas.map((area, index) => (
            <div
              key={area.id}
              draggable
              onDragStart={() => setDragAreaId(area.id)}
              onDragEnd={() => setDragAreaId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropSeatingArea(area.id)}
              style={{
                display: "grid",
                gap: 10,
                padding: "12px 12px",
                border:
                  dragAreaId === area.id
                    ? "1px solid var(--pos-saffron)"
                    : "1px solid var(--pos-line)",
                borderRadius: 8,
                background:
                  dragAreaId === area.id ? "var(--pos-saffron-tint)" : "var(--pos-surface)",
                cursor: "grab",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(160px, 1.4fr) auto auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  className="pos-input"
                  value={area.name}
                  onChange={(event) =>
                    setSeatingAreas((current) =>
                      current.map((entry) =>
                        entry.id === area.id ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                  aria-label="Area name"
                />
                <label style={{ fontSize: 12, color: "var(--pos-tx-sec)", display: "flex", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={area.active !== false}
                    onChange={(event) =>
                      setSeatingAreas((current) =>
                        current.map((entry) =>
                          entry.id === area.id ? { ...entry, active: event.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  Active
                </label>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => moveSeatingArea(area.id, -1)}
                    disabled={index === 0}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => moveSeatingArea(area.id, 1)}
                    disabled={index === seatingAreas.length - 1}
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => removeSeatingArea(area.id)}
                    disabled={
                      area.active !== false &&
                      seatingAreas.filter((entry) => entry.active !== false).length <= 1
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div>
                  <label className="pos-label">Tables</label>
                  <input
                    type="number"
                    min={0}
                    max={FLOOR_LAYOUT_LIMITS.MAX_AREA_TABLES}
                    className="pos-input"
                    value={area.tableCount}
                    onChange={(event) =>
                      setSeatingAreas((current) =>
                        current.map((entry) =>
                          entry.id === area.id
                            ? {
                                ...entry,
                                tableCount: Math.max(
                                  0,
                                  Math.min(
                                    FLOOR_LAYOUT_LIMITS.MAX_AREA_TABLES,
                                    Number(event.target.value) || 0,
                                  ),
                                ),
                              }
                            : entry,
                        ),
                      )
                    }
                    style={{ textAlign: "center", fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label className="pos-label">Name style</label>
                  <select
                    className="pos-input"
                    value={area.namingMode}
                    onChange={(event) =>
                      setSeatingAreas((current) =>
                        current.map((entry) =>
                          entry.id === area.id
                            ? {
                                ...entry,
                                namingMode: event.target.value === "prefix" ? "prefix" : "number",
                                prefix:
                                  event.target.value === "prefix" && !entry.prefix
                                    ? suggestPrefixFromAreaName(entry.name)
                                    : entry.prefix,
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="number">Number only (1, 2, 3…)</option>
                    <option value="prefix">Prefix (G1, GF1…)</option>
                  </select>
                </div>
                {area.namingMode === "prefix" ? (
                  <div>
                    <label className="pos-label">Prefix</label>
                    <input
                      className="pos-input"
                      value={area.prefix}
                      onChange={(event) =>
                        setSeatingAreas((current) =>
                          current.map((entry) =>
                            entry.id === area.id
                              ? { ...entry, prefix: event.target.value.toUpperCase().slice(0, 6) }
                              : entry,
                          ),
                        )
                      }
                      placeholder="G, GF, F, B"
                      style={{ fontWeight: 700, textTransform: "uppercase" }}
                    />
                  </div>
                ) : null}
                <div>
                  <label className="pos-label">Default seats</label>
                  <input
                    type="number"
                    min={1}
                    max={FLOOR_LAYOUT_LIMITS.MAX_SEATS}
                    className="pos-input"
                    value={area.defaultSeats}
                    onChange={(event) =>
                      setSeatingAreas((current) =>
                        current.map((entry) =>
                          entry.id === area.id
                            ? {
                                ...entry,
                                defaultSeats: Math.max(
                                  1,
                                  Math.min(
                                    FLOOR_LAYOUT_LIMITS.MAX_SEATS,
                                    Number(event.target.value) || 1,
                                  ),
                                ),
                              }
                            : entry,
                        ),
                      )
                    }
                    style={{ textAlign: "center", fontWeight: 700 }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22, borderTop: "1px solid var(--pos-surface-sunken)", paddingTop: 18 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <label className="pos-label" style={{ marginBottom: 0 }}>
              Preview
            </label>
            <span style={{ fontSize: 12, color: "var(--pos-tx-muted)" }}>
              {floorPreview.total} table{floorPreview.total === 1 ? "" : "s"} total
              {floorPreview.error ? ` · ${floorPreview.error}` : ""}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--pos-muted,var(--pos-tx-muted))", marginTop: 4, marginBottom: 10 }}>
            Names restart per area. Optional overrides below become VIP / odd seat counts on Save.
          </p>
          {floorPreview.tables.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--pos-tx-sub)" }}>
              Add table counts above to preview names.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12, maxHeight: 360, overflow: "auto", paddingRight: 4 }}>
              {seatingAreas
                .filter((area) => area.active !== false && area.tableCount > 0)
                .map((area) => {
                  const areaTables = floorPreview.tables.filter((table) => table.areaId === area.id);
                  if (!areaTables.length) {
                    return null;
                  }
                  return (
                    <div key={area.id}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--pos-tx-sec)",
                          marginBottom: 6,
                        }}
                      >
                        {area.name}
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {areaTables.map((table) => {
                          const key = previewKey(table.areaId, table.name);
                          const override = previewOverrides[key];
                          const displayName = override?.name ?? table.name;
                          const displaySeats = override?.seats ?? table.seats;
                          return (
                            <div
                              key={key}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(100px, 140px) 88px",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <input
                                className="pos-input"
                                value={displayName}
                                aria-label={`Name for planned table ${table.name}`}
                                onChange={(event) =>
                                  setPreviewOverrides((current) => ({
                                    ...current,
                                    [key]: {
                                      name: event.target.value,
                                      seats: displaySeats,
                                    },
                                  }))
                                }
                                style={{ fontWeight: 700 }}
                              />
                              <input
                                type="number"
                                min={1}
                                max={FLOOR_LAYOUT_LIMITS.MAX_SEATS}
                                className="pos-input"
                                aria-label={`Seats for planned table ${table.name}`}
                                value={displaySeats}
                                onChange={(event) =>
                                  setPreviewOverrides((current) => ({
                                    ...current,
                                    [key]: {
                                      name: displayName,
                                      seats: Math.max(
                                        1,
                                        Math.min(
                                          FLOOR_LAYOUT_LIMITS.MAX_SEATS,
                                          Number(event.target.value) || 1,
                                        ),
                                      ),
                                    },
                                  }))
                                }
                                style={{ textAlign: "center", fontWeight: 700 }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <Button
            onClick={saveFloorLayout}
            disabled={savingTables || Boolean(floorPreview.error)}
            variant="primary"
          >
            {savingTables ? "Saving..." : "Save"}
          </Button>
          {tableStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: isTableStatusSuccess(tableStatus)
                  ? "var(--pos-success-tint)"
                  : "var(--pos-danger-tint)",
                color: isTableStatusSuccess(tableStatus)
                  ? "var(--pos-success)"
                  : "var(--pos-danger)",
              }}
            >
              {tableStatus}
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--pos-muted,var(--pos-tx-muted))", marginTop: 8 }}>
          Reducing table count will not remove tables that still have open orders.
        </p>

        <div style={{ marginTop: 22, borderTop: "1px solid var(--pos-surface-sunken)", paddingTop: 18 }}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowAdvancedMapping((open) => !open)}
          >
            {showAdvancedMapping ? "Hide advanced table edits" : "Advanced table edits"}
          </Button>
          {showAdvancedMapping ? (
            <>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--pos-muted,var(--pos-tx-muted))",
                  marginTop: 10,
                  marginBottom: 10,
                }}
              >
                Rename one table, change odd seat counts, or move a table after the layout is saved.
              </p>
              <div style={{ display: "grid", gap: 8, maxHeight: 320, overflow: "auto", paddingRight: 4 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px, 1fr) 88px minmax(150px, 1fr)",
                    gap: 8,
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--pos-tx-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <span>Name</span>
                  <span>Seats</span>
                  <span>Area</span>
                </div>
                {tableDocs
                  .slice()
                  .sort((a, b) => a.id - b.id)
                  .map((table) => (
                    <div
                      key={table.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px, 1fr) 88px minmax(150px, 1fr)",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        className="pos-input"
                        value={tableNameDraft[table.id] ?? table.name ?? ""}
                        aria-label={`Name for table ${table.id}`}
                        onChange={(event) =>
                          setTableNameDraft((current) => ({
                            ...current,
                            [table.id]: event.target.value,
                          }))
                        }
                        style={{ fontWeight: 700 }}
                      />
                      <input
                        type="number"
                        min={1}
                        max={50}
                        className="pos-input"
                        aria-label={`Seats for ${table.name || `Table ${table.id}`}`}
                        value={tableSeatsDraft[table.id] ?? table.seats ?? 4}
                        onChange={(event) =>
                          setTableSeatsDraft((current) => ({
                            ...current,
                            [table.id]: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                          }))
                        }
                        style={{ textAlign: "center", fontWeight: 700 }}
                      />
                      <select
                        className="pos-input"
                        value={tableAreaDraft[table.id] || table.areaId || "area:main"}
                        onChange={(event) =>
                          setTableAreaDraft((current) => ({
                            ...current,
                            [table.id]: event.target.value,
                          }))
                        }
                      >
                        {seatingAreas
                          .filter((area) => area.active !== false)
                          .map((area) => (
                            <option key={area.id} value={area.id}>
                              {area.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Button
                  onClick={saveAdvancedTableEdits}
                  disabled={savingAdvancedTables || tableDocs.length === 0}
                  variant="secondary"
                >
                  {savingAdvancedTables ? "Saving..." : "Save table edits"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Service Modes Section ─────────────────────────────────────── */}
      <div
        className="pos-card pos-card-p"
        style={{ marginTop: 24 }}
        data-settings-sec="operations"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}>⧉</span>
          Service Modes
        </div>

        <p
          style={{
            fontSize: 13,
            color: "var(--pos-tx-sub,var(--pos-tx-sub))",
            marginBottom: 14,
            marginTop: 0,
          }}
        >
          Enable only the operational modes your restaurant uses. Billing will show only enabled
          modes.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {[...serviceModes]
            .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
            .map((mode) => (
            <label
              key={mode.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--pos-line)",
                borderRadius: 10,
                background: mode.enabled ? "var(--pos-surface-sunken)" : "var(--pos-surface)",
              }}
            >
              <input
                type="checkbox"
                checked={mode.enabled}
                onChange={() => toggleServiceMode(mode.id)}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "var(--pos-tx)", fontSize: 14 }}>{mode.name}</div>
                <div style={{ color: "var(--pos-tx-sub)", fontSize: 12 }}>
                  {mode.requiresTable ? "Table required" : "No table"}
                  {mode.externalPayment ? " · External payment" : " · In-POS payment"}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--pos-tx-sec)",
                  }}
                >
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={mode.supportsKOT}
                        onChange={(event) =>
                          updateServiceModeField(mode.id, "supportsKOT", event.target.checked)
                        }
                      />
                      Supports KOT
                    </label>
                    <div style={{ color: "var(--pos-tx-muted)", marginLeft: 22 }}>Show kitchen ticket actions</div>
                  </div>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={mode.immediateBilling}
                        onChange={(event) =>
                          updateServiceModeField(mode.id, "immediateBilling", event.target.checked)
                        }
                      />
                      Immediate billing
                    </label>
                    <div style={{ color: "var(--pos-tx-muted)", marginLeft: 22 }}>Pay first, then auto-print flow</div>
                  </div>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={mode.requiresCustomer}
                        onChange={(event) =>
                          updateServiceModeField(mode.id, "requiresCustomer", event.target.checked)
                        }
                      />
                      Requires customer
                    </label>
                    <div style={{ color: "var(--pos-tx-muted)", marginLeft: 22 }}>Ask for name or phone before order</div>
                  </div>
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={mode.supportsOpenOrders}
                        onChange={(event) =>
                          updateServiceModeField(mode.id, "supportsOpenOrders", event.target.checked)
                        }
                      />
                      Supports open orders
                    </label>
                    <div style={{ color: "var(--pos-tx-muted)", marginLeft: 22 }}>
                      Allow hold/ready lifecycle before payment
                    </div>
                  </div>
                </div>
                {mode.supportsKOT && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--pos-tx-sub)" }}>Payment print flow</span>
                    <select
                      className="pos-input"
                      value={mode.paymentPrintSequence}
                      onChange={(event) =>
                        updateServiceModeField(
                          mode.id,
                          "paymentPrintSequence",
                          event.target.value as ServiceMode["paymentPrintSequence"],
                        )
                      }
                      style={{ maxWidth: 220, height: 36 }}
                    >
                      <option value="bill_only">Bill only</option>
                      <option value="bill_then_kot">Bill then KOT</option>
                      <option value="kot_then_bill">KOT then Bill</option>
                    </select>
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <Button
            onClick={saveServiceModes}
            disabled={savingServiceModes}
            variant="primary"
          >
            {savingServiceModes ? "Saving..." : "Save Service Modes"}
          </Button>
          {serviceModeStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: serviceModeStatus.includes("") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: serviceModeStatus.includes("") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {serviceModeStatus}
            </div>
          )}
        </div>
      </div>

      {/* ── Categories Section ─────────────────────────────────────────── */}
      <div
        className="pos-card pos-card-p"
        style={{ marginTop: 24 }}
        data-settings-sec="operations"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}></span>
          Menu Categories
        </div>

        <p
          style={{
            fontSize: 13,
            color: "var(--pos-tx-sub,var(--pos-tx-sub))",
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
          <Button
            onClick={addCategory}
            disabled={!normalizeCategoryName(newCategory)}
            variant="primary"
          >
            + Add
          </Button>
        </div>

        {/* Category list */}
        {categories.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--pos-line-strong)", padding: "12px 0" }}>
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
                  background: "var(--pos-saffron-tint)",
                  border: "1.5px solid var(--pos-saffron-line)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--pos-saffron-text)",
                }}
              >
                {cat}
                <button
                  onClick={() => removeCategory(cat)}
                  title={`Remove "${cat}"`}
                  aria-label={`Remove ${cat}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--pos-saffron-deep)",
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 4,
                    display: "inline-flex",
                  }}
                >
                  <Icon icon={X} size="sm" />
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveCategories}
            disabled={savingCategories}
            variant="primary"
          >
            {savingCategories ? "Saving…" : "Save Categories"}
          </Button>
          {categoryStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: categoryStatus.includes("\u2713") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: categoryStatus.includes("\u2713") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {categoryStatus}
            </div>
          )}
        </div>
      </div>

      {/* ── Menu Variant Options Section ───────────────────────────────── */}
      <div
        className="pos-card pos-card-p"
        style={{ marginTop: 24 }}
        data-settings-sec="operations"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}></span>
          Menu Variant Options
        </div>

        <p
          style={{
            fontSize: 13,
            color: "var(--pos-tx-sub,var(--pos-tx-sub))",
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
          <Button
            onClick={addMenuVariantOption}
            disabled={!normalizeCategoryName(newMenuVariantOption)}
            variant="primary"
          >
            + Add
          </Button>
        </div>

        {menuVariantOptions.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--pos-line-strong)", padding: "12px 0" }}>
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
                  background: "var(--pos-teal-tint)",
                  border: "1.5px solid var(--pos-teal-line)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--pos-teal-strong)",
                }}
              >
                {option}
                <button
                  onClick={() => removeMenuVariantOption(option)}
                  title={`Remove "${option}"`}
                  aria-label={`Remove ${option}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--pos-teal)",
                    lineHeight: 1,
                    padding: "0 2px",
                    borderRadius: 4,
                    display: "inline-flex",
                  }}
                >
                  <Icon icon={X} size="sm" />
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveMenuVariantOptions}
            disabled={savingMenuVariantOptions}
            variant="primary"
          >
            {savingMenuVariantOptions ? "Saving…" : "Save Variant Options"}
          </Button>
          {menuVariantStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: menuVariantStatus.includes("") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: menuVariantStatus.includes("") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {menuVariantStatus}
            </div>
          )}
        </div>
      </div>

      {/* Attendance Shift Master Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="operations"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon icon={Timer} size="sm" />
          Attendance Shift Master
        </div>

        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 16, lineHeight: 1.6 }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pos-tx,var(--pos-tx))" }}>
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
              <span style={{ fontSize: 12, color: "var(--pos-tx-sub,var(--pos-tx-sub))" }}>hours</span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveShiftConfig}
            disabled={savingShifts}
            variant="primary"
          >
            {savingShifts ? "Saving..." : "Save Shift Master"}
          </Button>
          {shiftStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: shiftStatus.includes("") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: shiftStatus.includes("") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {shiftStatus}
            </div>
          )}
        </div>
      </div>

      <div className="pos-card pos-card-p" style={{ marginBottom: 24 }} data-settings-sec="operations">
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon icon={Timer} size="sm" />
          Attendance Holidays
        </div>

        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          Restaurant-wide closed days. Daily attendance shows a holiday reminder on these dates.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="date"
            className="pos-input"
            value={holidayDraft}
            onChange={(event) => setHolidayDraft(event.target.value)}
            aria-label="Holiday date"
          />
          <Button type="button"  onClick={addHolidayDraft} variant="secondary">
            Add date
          </Button>
        </div>

        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {attendanceHolidays.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--pos-tx-sub)" }}>No holidays configured yet.</div>
          ) : (
            attendanceHolidays.map((date) => (
              <div
                key={date}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 12px",
                  border: "1px solid var(--pos-line)",
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{date}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setAttendanceHolidays((previous) => previous.filter((entry) => entry !== date))
                  }
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            paddingTop: 14,
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveHolidayConfig}
            disabled={savingHolidays}
            variant="primary"
          >
            {savingHolidays ? "Saving..." : "Save Holidays"}
          </Button>
          {holidayStatus ? (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: holidayStatus.includes("Saved") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: holidayStatus.includes("Saved") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {holidayStatus}
            </div>
          ) : null}
        </div>
      </div>
      </>
      )}

      {sectionVisible("retention") && (
      <>
      {/* Audit Retention Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="retention"
        id="settings-sec-retention"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 15 }}></span>
          Audit Log Retention
        </div>

        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 16, lineHeight: 1.6 }}>
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveAuditConfig}
            disabled={savingAudit}
            variant="primary"
          >
            {savingAudit ? "Saving…" : "Save Retention Policy"}
          </Button>
          {auditStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: auditStatus.includes("\u2713") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: auditStatus.includes("\u2713") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {auditStatus}
            </div>
          )}
        </div>
      </div>

      {/* Order History Retention Section */}
      <div
        className="pos-card pos-card-p"
        style={{ marginBottom: 24 }}
        data-settings-sec="retention"
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--pos-muted,var(--pos-tx-muted))",
            marginBottom: 20,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon icon={Clock3} size="sm" />
          Order History Retention
        </div>

        <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginBottom: 16, lineHeight: 1.6 }}>
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
            borderTop: "1px solid var(--pos-border,var(--pos-line))",
          }}
        >
          <Button
            onClick={saveHistoryConfig}
            disabled={savingHistory}
            variant="primary"
          >
            {savingHistory ? "Saving\u2026" : "Save Retention Policy"}
          </Button>
          {historyStatus && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: historyStatus.includes("\u2713") ? "var(--pos-success-tint)" : "var(--pos-danger-tint)",
                color: historyStatus.includes("\u2713") ? "var(--pos-success)" : "var(--pos-danger)",
              }}
            >
              {historyStatus}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      <ConfirmModal
        open={settingsConfirm?.kind === "restore-backup"}
        title="Restore database backup?"
        onClose={() => setSettingsConfirm(null)}
        onConfirm={confirmRestoreBackup}
        confirmLabel="Restore backup"
        loading={backupBusy === "restore"}
        variant="primary"
      >
        <p style={{ margin: 0 }}>
          Restore replaces the current POS database. A safety backup will be created first.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={settingsConfirm?.kind === "launch-update"}
        title="Launch update installer?"
        onClose={() => setSettingsConfirm(null)}
        onConfirm={confirmLaunchUpdate}
        confirmLabel="Launch installer"
        loading={updateBusy === "launch"}
        variant="primary"
      >
        <p style={{ margin: 0 }}>RestoNiti will close and the update installer will open.</p>
      </ConfirmModal>

      <ConfirmModal
        open={settingsConfirm?.kind === "prepare-with-activity"}
        title="Continue preparing update?"
        onClose={() => setSettingsConfirm(null)}
        onConfirm={confirmPrepareWithActivity}
        confirmLabel="Continue anyway"
        loading={updateBusy === "prepare"}
        variant="primary"
        warning="Updating now may interrupt operations."
      >
        {settingsConfirm?.kind === "prepare-with-activity" ? (
          <pre className="ui-confirm-details">{businessActivityText(settingsConfirm.activity)}</pre>
        ) : null}
      </ConfirmModal>

      <ConfirmModal
        open={settingsConfirm?.kind === "rollback"}
        title="Rollback update?"
        onClose={() => setSettingsConfirm(null)}
        onConfirm={confirmRollbackUpdate}
        confirmLabel="Rollback update"
        loading={updateBusy === "rollback"}
      >
        {settingsConfirm?.kind === "rollback" ? (
          <>
            <p style={{ margin: 0 }}>
              Rollback will restore the database to the pre-update backup.
            </p>
            <pre className="ui-confirm-details">
              {`Orders created after update: ${settingsConfirm.risk.orders || 0}\nPayments created after update: ${settingsConfirm.risk.payments || 0}\n\nThese records will be lost.`}
            </pre>
          </>
        ) : null}
      </ConfirmModal>
    </div>
  );
}
