import { app, shell } from "electron";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { URL } from "url";
import {
  backupDatabase,
  getDatabasePath,
  getDb,
  replaceDatabaseFromBackupWithoutReopen,
  validateSqliteBackup,
} from "../db/sqlite";
import { posService } from "./posService";

export type UpdateManifest = {
  version: string;
  installerUrl: string;
  sha256: string;
  notes?: string[];
  installerSizeBytes?: number;
  rollbackInstallerUrl?: string;
  rollbackSha256?: string;
  rollbackInstallerSizeBytes?: number;
};

type UpdateStatus =
  | "idle"
  | "available"
  | "prepared"
  | "installing"
  | "successful"
  | "warning"
  | "failed"
  | "aborted"
  | "rolledBack";

type UpdateState = {
  status: UpdateStatus;
  previousVersion?: string;
  targetVersion?: string;
  targetInstallerPath?: string;
  rollbackInstallerPath?: string;
  preUpdateBackupPath?: string;
  emergencyBackupPath?: string | null;
  targetInstallerSha256?: string;
  rollbackInstallerSha256?: string;
  preparedAt?: number;
  installStartedAt?: number | null;
  healthCheckedAt?: number | null;
  failureReason?: string | null;
  healthResult?: "successful" | "warning" | "failed" | null;
  healthWarnings?: string[];
};

const ONE_GB = 1024 * 1024 * 1024;
const MANIFEST_FILE = "manifest.json";
const STATE_FILE = "state.json";
const INSTALLER_FILE = "installer.exe";
const ROLLBACK_INSTALLER_FILE = "rollback-installer.exe";
const PRE_UPDATE_BACKUP_FILE = "pre-update.sqlite";
const EMERGENCY_BACKUP_FILE = "emergency-backup.sqlite";
const INSTRUCTIONS_FILE = "ROLLBACK-INSTRUCTIONS.txt";

function now() {
  return Date.now();
}

function normalizeHash(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function assertHttpsUrl(url: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label}-invalid`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label}-must-use-https`);
  }
  return parsed;
}

function parseVersion(value: string) {
  const parts = String(value || "")
    .trim()
    .split(".")
    .map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("invalid-version");
  }
  return parts;
}

export function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

function hashFile(filePath: string) {
  const hash = createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 5;

function downloadBuffer(url: string, redirectsLeft = MAX_DOWNLOAD_REDIRECTS): Promise<Buffer> {
  const parsed = assertHttpsUrl(url, "download-url");
  return new Promise((resolve, reject) => {
    const req = https.get(parsed, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("download-too-many-redirects"));
          return;
        }
        downloadBuffer(new URL(res.headers.location, parsed).toString(), redirectsLeft - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download-failed:${res.statusCode || "unknown"}`));
        return;
      }
      const declared = Number(res.headers["content-length"] || 0);
      if (declared > MAX_DOWNLOAD_BYTES) {
        res.resume();
        reject(new Error("download-too-large"));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      res.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > MAX_DOWNLOAD_BYTES) {
          req.destroy();
          reject(new Error("download-too-large"));
          return;
        }
        chunks.push(buf);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("download-timeout"));
    });
  });
}

async function downloadJson<T>(url: string): Promise<T> {
  return JSON.parse((await downloadBuffer(url)).toString("utf8")) as T;
}

async function downloadFile(url: string, targetPath: string) {
  const data = await downloadBuffer(url);
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, data);
}

export function validateManifest(input: unknown): UpdateManifest {
  const manifest = input as Partial<UpdateManifest>;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest-invalid");
  }
  parseVersion(String(manifest.version || ""));
  assertHttpsUrl(String(manifest.installerUrl || ""), "installer-url");
  if (!normalizeHash(String(manifest.sha256 || ""))) {
    throw new Error("installer-sha256-required");
  }
  if (manifest.rollbackInstallerUrl) {
    assertHttpsUrl(manifest.rollbackInstallerUrl, "rollback-installer-url");
  }
  if (manifest.rollbackInstallerUrl && !normalizeHash(String(manifest.rollbackSha256 || ""))) {
    throw new Error("rollback-sha256-required");
  }
  return {
    version: String(manifest.version),
    installerUrl: String(manifest.installerUrl),
    sha256: normalizeHash(String(manifest.sha256)),
    notes: Array.isArray(manifest.notes) ? manifest.notes.map(String) : [],
    installerSizeBytes: Number(manifest.installerSizeBytes || 0) || undefined,
    rollbackInstallerUrl: manifest.rollbackInstallerUrl
      ? String(manifest.rollbackInstallerUrl)
      : undefined,
    rollbackSha256: manifest.rollbackSha256
      ? normalizeHash(String(manifest.rollbackSha256))
      : undefined,
    rollbackInstallerSizeBytes: Number(manifest.rollbackInstallerSizeBytes || 0) || undefined,
  };
}

function getUpdateManifestUrl() {
  return String(
    process.env.POS_UPDATE_MANIFEST_URL || process.env.VITE_UPDATE_MANIFEST_URL || "",
  ).trim();
}

function getRollbackManifestFields(manifest: UpdateManifest) {
  return {
    url:
      manifest.rollbackInstallerUrl || String(process.env.POS_ROLLBACK_INSTALLER_URL || "").trim(),
    sha256: normalizeHash(
      manifest.rollbackSha256 || String(process.env.POS_ROLLBACK_INSTALLER_SHA256 || ""),
    ),
    sizeBytes:
      Number(manifest.rollbackInstallerSizeBytes || 0) ||
      Number(process.env.POS_ROLLBACK_INSTALLER_SIZE_BYTES || 0) ||
      undefined,
  };
}

function getFreeSpaceBytes(targetDir: string) {
  if (process.platform !== "win32") {
    return Number.MAX_SAFE_INTEGER;
  }
  const root = path.parse(path.resolve(targetDir)).root.replace(/\\$/, "");
  const command = `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${root.replace(/'/g, "''")}'"; [Console]::Out.Write($d.FreeSpace)`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const free = Number(output);
  if (!Number.isFinite(free) || free <= 0) {
    throw new Error("disk-space-unavailable");
  }
  return free;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function createZip(entries: Array<{ name: string; data: Buffer | string }>) {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"));
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...fileParts, central, end]);
}

export class UpdateService {
  getUpdateRoot() {
    const localAppData = process.env.LOCALAPPDATA || path.dirname(app.getPath("userData"));
    return path.join(localAppData, "RestaurantPOS", "Updates");
  }

  getPaths() {
    const root = this.getUpdateRoot();
    return {
      root,
      diagnostics: path.join(root, "diagnostics"),
      manifest: path.join(root, MANIFEST_FILE),
      state: path.join(root, STATE_FILE),
      installer: path.join(root, INSTALLER_FILE),
      rollbackInstaller: path.join(root, ROLLBACK_INSTALLER_FILE),
      preUpdateBackup: path.join(root, PRE_UPDATE_BACKUP_FILE),
      emergencyBackup: path.join(root, EMERGENCY_BACKUP_FILE),
      instructions: path.join(root, INSTRUCTIONS_FILE),
    };
  }

  ensureUpdateDirs() {
    const paths = this.getPaths();
    ensureDir(paths.root);
    ensureDir(paths.diagnostics);
  }

  getLogPath() {
    return path.join(app.getPath("userData"), "logs");
  }

  appInfo() {
    this.ensureUpdateDirs();
    return {
      version: app.getVersion(),
      databasePath: getDatabasePath(),
      logPath: this.getLogPath(),
      updateStoragePath: this.getUpdateRoot(),
    };
  }

  readState(): UpdateState {
    return safeReadJson<UpdateState>(this.getPaths().state) || { status: "idle" };
  }

  writeState(state: UpdateState) {
    writeJson(this.getPaths().state, state);
  }

  appendHistory(event: string, detail: Record<string, unknown> = {}) {
    const filePath = path.join(this.getUpdateRoot(), "update-history.ndjson");
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({ event, at: new Date().toISOString(), ...detail })}\n`,
      "utf8",
    );
  }

  async checkForUpdates() {
    this.ensureUpdateDirs();
    const manifestUrl = getUpdateManifestUrl();
    if (!manifestUrl) {
      return {
        configured: false,
        updateAvailable: false,
        currentVersion: app.getVersion(),
        reason: "update-manifest-url-not-configured",
      };
    }
    assertHttpsUrl(manifestUrl, "manifest-url");
    const manifest = validateManifest(await downloadJson<unknown>(manifestUrl));
    writeJson(this.getPaths().manifest, manifest);
    const currentVersion = app.getVersion();
    const updateAvailable = compareVersions(manifest.version, currentVersion) > 0;
    this.appendHistory("update.check", {
      currentVersion,
      targetVersion: manifest.version,
      updateAvailable,
    });
    return {
      configured: true,
      updateAvailable,
      currentVersion,
      manifest,
      notes: manifest.notes || [],
      status: this.readState(),
    };
  }

  getBusinessActivity() {
    const activeOrders = posService.getActiveOrders();
    const openOrders = activeOrders.length;
    const pendingKots = activeOrders.filter((order: any) => order.kotStatus === "pending").length;
    const pendingPrintJobs = posService.listPrintJobs("pending").length;
    const failedPrintJobs = posService.listPrintJobs("failed").length;
    return {
      openOrders,
      pendingKots,
      pendingPrintJobs,
      failedPrintJobs,
      hasActivity: openOrders > 0 || pendingKots > 0 || pendingPrintJobs > 0 || failedPrintJobs > 0,
    };
  }

  validateDiskSpace(manifest: UpdateManifest) {
    const paths = this.getPaths();
    const dbPath = getDatabasePath();
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const required = Math.max(dbSize * 3 + Number(manifest.installerSizeBytes || 0) * 2, ONE_GB);
    const free = getFreeSpaceBytes(paths.root);
    if (free < required) {
      throw new Error("insufficient-disk-space");
    }
    return { required, free };
  }

  async ensureInstaller(
    url: string | undefined,
    expectedSha256: string,
    targetPath: string,
    label: string,
  ) {
    if (fs.existsSync(targetPath) && hashFile(targetPath) === expectedSha256) {
      return { path: targetPath, reused: true, sha256: expectedSha256 };
    }
    if (!url) {
      throw new Error(`${label}-installer-required`);
    }
    await downloadFile(url, targetPath);
    const actual = hashFile(targetPath);
    if (actual !== expectedSha256) {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        // best effort cleanup
      }
      throw new Error(`${label}-installer-sha256-mismatch`);
    }
    return { path: targetPath, reused: false, sha256: actual };
  }

  writeRollbackInstructions() {
    const paths = this.getPaths();
    const content = [
      "RestoNiti rollback instructions",
      "",
      "Use these steps only if RestoNiti cannot start after an update.",
      "",
      "1. Close RestoNiti completely.",
      `2. Copy "${paths.preUpdateBackup}" to "${getDatabasePath()}".`,
      `3. Delete "${getDatabasePath()}-wal" and "${getDatabasePath()}-shm" if they exist.`,
      `4. Run "${paths.rollbackInstaller}".`,
      "5. Restart RestoNiti.",
      "",
      "This restores the database snapshot from immediately before the update.",
      "Orders, payments, and settings created after the update will be lost.",
      "",
    ].join(os.EOL);
    fs.writeFileSync(paths.instructions, content, "utf8");
  }

  async prepareUpdate(options: { allowBusinessActivity?: boolean } = {}) {
    this.ensureUpdateDirs();
    const manifest = safeReadJson<UpdateManifest>(this.getPaths().manifest);
    if (!manifest) {
      throw new Error("update-manifest-not-checked");
    }
    const validManifest = validateManifest(manifest);
    if (compareVersions(validManifest.version, app.getVersion()) <= 0) {
      throw new Error("update-not-newer");
    }

    const businessActivity = this.getBusinessActivity();
    if (businessActivity.hasActivity && !options.allowBusinessActivity) {
      return { ok: false, reason: "business-activity", businessActivity };
    }

    const paths = this.getPaths();
    const disk = this.validateDiskSpace(validManifest);
    await backupDatabase(paths.preUpdateBackup);
    validateSqliteBackup(paths.preUpdateBackup);

    const rollback = getRollbackManifestFields(validManifest);
    if (!rollback.sha256) {
      throw new Error("rollback-installer-sha256-required");
    }
    const targetInstaller = await this.ensureInstaller(
      validManifest.installerUrl,
      validManifest.sha256,
      paths.installer,
      "target",
    );
    const rollbackInstaller = await this.ensureInstaller(
      rollback.url,
      rollback.sha256,
      paths.rollbackInstaller,
      "rollback",
    );

    this.writeRollbackInstructions();
    const state: UpdateState = {
      status: "prepared",
      previousVersion: app.getVersion(),
      targetVersion: validManifest.version,
      targetInstallerPath: targetInstaller.path,
      rollbackInstallerPath: rollbackInstaller.path,
      preUpdateBackupPath: paths.preUpdateBackup,
      emergencyBackupPath: null,
      targetInstallerSha256: targetInstaller.sha256,
      rollbackInstallerSha256: rollbackInstaller.sha256,
      preparedAt: now(),
      installStartedAt: null,
      healthCheckedAt: null,
      failureReason: null,
      healthResult: null,
      healthWarnings: [],
    };
    this.writeState(state);
    this.appendHistory("update.prepared", {
      previousVersion: state.previousVersion,
      targetVersion: state.targetVersion,
    });
    return { ok: true, state, businessActivity, disk };
  }

  validatePreparedState(state = this.readState()) {
    if (state.status !== "prepared") {
      throw new Error("update-not-prepared");
    }
    if (!state.targetInstallerPath || !state.rollbackInstallerPath || !state.preUpdateBackupPath) {
      throw new Error("update-artifacts-missing");
    }
    if (
      !fs.existsSync(state.targetInstallerPath) ||
      hashFile(state.targetInstallerPath) !== state.targetInstallerSha256
    ) {
      throw new Error("target-installer-invalid");
    }
    if (
      !fs.existsSync(state.rollbackInstallerPath) ||
      hashFile(state.rollbackInstallerPath) !== state.rollbackInstallerSha256
    ) {
      throw new Error("rollback-installer-invalid");
    }
    validateSqliteBackup(state.preUpdateBackupPath);
    return state;
  }

  async launchPreparedUpdate() {
    const state = this.validatePreparedState();
    const next: UpdateState = { ...state, status: "installing", installStartedAt: now() };
    this.writeState(next);
    this.appendHistory("update.install.started", {
      previousVersion: next.previousVersion,
      targetVersion: next.targetVersion,
    });
    const result = await shell.openPath(state.targetInstallerPath!);
    if (result) {
      this.writeState({ ...next, status: "failed", failureReason: result });
      throw new Error(`installer-launch-failed:${result}`);
    }
    app.quit();
    return { ok: true };
  }

  runHealthCheck() {
    const warnings: string[] = [];
    let result: "successful" | "warning" | "failed" = "successful";
    let failureReason: string | null = null;

    try {
      const integrity = getDb().pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        throw new Error("sqlite-integrity-check-failed");
      }
      const admin = getDb()
        .prepare("SELECT username FROM users WHERE role = 'admin' AND active = 1 LIMIT 1")
        .get();
      if (!admin) {
        throw new Error("active-admin-missing");
      }
      ["config:printers", "config:tables", "config:branding"].forEach((key) => {
        posService.getSetting(key);
      });
      getDb().prepare("SELECT COUNT(*) AS count FROM print_jobs").get();

      const printers = (posService.getSetting("config:printers") as any) || {};
      if (!String(printers.kitchenPrinterIp || "").trim()) {
        warnings.push("Kitchen printer is not configured.");
      }
      if (!String(printers.counterPrinterIp || "").trim()) {
        warnings.push("Counter printer is not configured.");
      }
      const pending = posService.listPrintJobs("pending").length;
      const failed = posService.listPrintJobs("failed").length;
      if (pending > 0) {
        warnings.push(`${pending} pending print job(s) remain in the queue.`);
      }
      if (failed > 0) {
        warnings.push(`${failed} failed print job(s) remain in the queue.`);
      }
      if (warnings.length) {
        result = "warning";
      }
    } catch (error: any) {
      result = "failed";
      failureReason = error?.message || String(error);
    }
    return { result, warnings, failureReason };
  }

  processStartupState() {
    const state = this.readState();
    if (state.status !== "installing") {
      return state;
    }
    const currentVersion = app.getVersion();
    if (state.previousVersion && currentVersion === state.previousVersion) {
      const next: UpdateState = {
        ...state,
        status: "aborted",
        failureReason: "installer-cancelled-or-not-completed",
      };
      this.writeState(next);
      this.appendHistory("update.install.aborted", { currentVersion });
      return next;
    }
    if (state.targetVersion && currentVersion === state.targetVersion) {
      const health = this.runHealthCheck();
      const next: UpdateState = {
        ...state,
        status: health.result === "successful" ? "successful" : health.result,
        healthCheckedAt: now(),
        healthResult: health.result,
        healthWarnings: health.warnings,
        failureReason: health.failureReason,
      };
      this.writeState(next);
      this.appendHistory(`update.health.${health.result}`, {
        targetVersion: state.targetVersion,
        failureReason: health.failureReason,
        warnings: health.warnings,
      });
      return next;
    }
    return state;
  }

  getRollbackRisk(state = this.readState()) {
    const since = Number(state.installStartedAt || state.preparedAt || 0);
    if (!since) {
      return { orders: 0, payments: 0, paidOrders: 0 };
    }
    const orders = getDb()
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE created_at >= ?")
      .get(since) as { count?: number };
    const payments = getDb()
      .prepare("SELECT COUNT(*) AS count FROM payments WHERE received_at >= ?")
      .get(since) as { count?: number };
    const paidOrders = getDb()
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid' AND created_at >= ?")
      .get(since) as { count?: number };
    return {
      orders: Number(orders?.count || 0),
      payments: Number(payments?.count || 0),
      paidOrders: Number(paidOrders?.count || 0),
    };
  }

  getStatus() {
    const state = this.readState();
    return {
      state,
      app: this.appInfo(),
      rollbackAvailable: this.isRollbackAvailable(state),
      rollbackRisk: this.getRollbackRisk(state),
      manifest: safeReadJson<UpdateManifest>(this.getPaths().manifest),
    };
  }

  isRollbackAvailable(state = this.readState()) {
    try {
      if (
        !state.rollbackInstallerPath ||
        !state.preUpdateBackupPath ||
        !state.rollbackInstallerSha256
      ) {
        return false;
      }
      if (
        !fs.existsSync(state.rollbackInstallerPath) ||
        hashFile(state.rollbackInstallerPath) !== state.rollbackInstallerSha256
      ) {
        return false;
      }
      validateSqliteBackup(state.preUpdateBackupPath);
      return true;
    } catch {
      return false;
    }
  }

  async rollbackLast(options: { confirmed?: boolean } = {}) {
    const state = this.readState();
    if (!this.isRollbackAvailable(state)) {
      throw new Error("rollback-unavailable");
    }
    const risk = this.getRollbackRisk(state);
    if (!options.confirmed) {
      return { ok: false, reason: "confirmation-required", risk };
    }
    const paths = this.getPaths();
    await backupDatabase(paths.emergencyBackup);
    validateSqliteBackup(paths.emergencyBackup);
    replaceDatabaseFromBackupWithoutReopen(state.preUpdateBackupPath!);
    const next: UpdateState = {
      ...state,
      status: "rolledBack",
      emergencyBackupPath: paths.emergencyBackup,
    };
    this.writeState(next);
    this.appendHistory("update.rollback.started", {
      previousVersion: state.previousVersion,
      targetVersion: state.targetVersion,
      risk,
    });
    const result = await shell.openPath(state.rollbackInstallerPath!);
    if (result) {
      throw new Error(`rollback-installer-launch-failed:${result}`);
    }
    app.quit();
    return { ok: true, risk };
  }

  exportDiagnostics() {
    this.ensureUpdateDirs();
    const paths = this.getPaths();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetPath = path.join(paths.diagnostics, `RestaurantPOS-Diagnostics-${stamp}.zip`);
    const entries: Array<{ name: string; data: Buffer | string }> = [];
    entries.push({ name: "app-info.json", data: JSON.stringify(this.appInfo(), null, 2) });
    entries.push({ name: "update-state.json", data: JSON.stringify(this.readState(), null, 2) });
    const manifest = safeReadJson<UpdateManifest>(paths.manifest);
    if (manifest) {
      entries.push({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });
    }
    const historyPath = path.join(paths.root, "update-history.ndjson");
    if (fs.existsSync(historyPath)) {
      entries.push({ name: "update-history.ndjson", data: fs.readFileSync(historyPath) });
    }
    let integrity = "unknown";
    try {
      integrity = String(getDb().pragma("integrity_check", { simple: true }));
    } catch (error: any) {
      integrity = error?.message || String(error);
    }
    entries.push({
      name: "runtime-summary.json",
      data: JSON.stringify(
        {
          sqliteIntegrity: integrity,
          printerConfig: posService.getSetting("config:printers"),
          printQueue: {
            pending: posService.listPrintJobs("pending").length,
            failed: posService.listPrintJobs("failed").length,
          },
          backups: posService.listBackups(),
        },
        null,
        2,
      ),
    });
    const logPath = this.getLogPath();
    if (fs.existsSync(logPath)) {
      for (const file of fs
        .readdirSync(logPath)
        .filter((name) => name.endsWith(".log"))
        .slice(-5)) {
        entries.push({ name: `logs/${file}`, data: fs.readFileSync(path.join(logPath, file)) });
      }
    }
    fs.writeFileSync(targetPath, createZip(entries));
    return { ok: true, path: targetPath };
  }
}

export const updateService = new UpdateService();
