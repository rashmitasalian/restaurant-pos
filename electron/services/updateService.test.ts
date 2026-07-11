jest.mock("electron", () => ({
  app: {
    getVersion: jest.fn(() => "1.0.0"),
    getPath: jest.fn(() => "C:\\tmp\\Restaurant POS"),
    quit: jest.fn(),
  },
  shell: {
    openPath: jest.fn(),
  },
}));

jest.mock("child_process", () => ({
  execFileSync: jest.fn(() => String(2 * 1024 * 1024 * 1024)),
}));

jest.mock("../db/sqlite", () => ({
  backupDatabase: jest.fn(),
  getDatabasePath: jest.fn(),
  getDb: jest.fn(),
  replaceDatabaseFromBackupWithoutReopen: jest.fn(),
  validateSqliteBackup: jest.fn(),
}));

jest.mock("./posService", () => ({
  posService: {
    getActiveOrders: jest.fn(() => []),
    listPrintJobs: jest.fn(() => []),
    getSetting: jest.fn(() => ({})),
    listBackups: jest.fn(() => []),
  },
}));

import { app, shell } from "electron";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  backupDatabase,
  getDatabasePath,
  getDb,
  replaceDatabaseFromBackupWithoutReopen,
  validateSqliteBackup,
} from "../db/sqlite";
import { posService } from "./posService";
import { compareVersions, UpdateService, validateManifest, type UpdateManifest } from "./updateService";

const ONE_GB = 1024 * 1024 * 1024;
const appGetVersionMock = app.getVersion as jest.Mock;
const appQuitMock = app.quit as jest.Mock;
const shellOpenPathMock = shell.openPath as jest.Mock;
const execFileSyncMock = execFileSync as jest.Mock;
const backupDatabaseMock = backupDatabase as jest.Mock;
const getDatabasePathMock = getDatabasePath as jest.Mock;
const getDbMock = getDb as jest.Mock;
const replaceDatabaseMock = replaceDatabaseFromBackupWithoutReopen as jest.Mock;
const validateSqliteBackupMock = validateSqliteBackup as jest.Mock;
const getActiveOrdersMock = posService.getActiveOrders as jest.Mock;
const listPrintJobsMock = posService.listPrintJobs as jest.Mock;
const getSettingMock = posService.getSetting as jest.Mock;

function sha256(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function createService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pos-update-"));
  process.env.LOCALAPPDATA = root;
  const dbPath = path.join(root, "data", "restaurant-pos.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, "database");
  getDatabasePathMock.mockReturnValue(dbPath);
  const service = new UpdateService();
  service.ensureUpdateDirs();
  return { service, root, dbPath, paths: service.getPaths() };
}

function writeManifest(service: UpdateService, manifest: UpdateManifest) {
  fs.writeFileSync(service.getPaths().manifest, `${JSON.stringify(manifest)}\n`, "utf8");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function validManifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    version: "1.1.0",
    installerUrl: "https://updates.example.com/RestaurantPOS-1.1.0.exe",
    sha256: sha256("target-installer"),
    rollbackInstallerUrl: "https://updates.example.com/RestaurantPOS-1.0.0.exe",
    rollbackSha256: sha256("rollback-installer"),
    installerSizeBytes: 20,
    notes: ["Improved printing"],
    ...overrides,
  };
}

function mockCountDb(counts: { orders?: number; payments?: number; paidOrders?: number } = {}) {
  const db = {
    pragma: jest.fn(() => "ok"),
    prepare: jest.fn((sql: string) => ({
      get: jest.fn(() => {
        if (sql.includes("FROM users")) {
          return { username: "admin" };
        }
        if (sql.includes("FROM payments")) {
          return { count: counts.payments || 0 };
        }
        if (sql.includes("status = 'paid'")) {
          return { count: counts.paidOrders || 0 };
        }
        if (sql.includes("FROM orders")) {
          return { count: counts.orders || 0 };
        }
        return { count: 0 };
      }),
    })),
  };
  getDbMock.mockReturnValue(db);
  return db;
}

describe("updateService", () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalManifestUrl = process.env.POS_UPDATE_MANIFEST_URL;
  const originalRollbackUrl = process.env.POS_ROLLBACK_INSTALLER_URL;
  const originalRollbackSha = process.env.POS_ROLLBACK_INSTALLER_SHA256;

  beforeEach(() => {
    jest.clearAllMocks();
    appGetVersionMock.mockReturnValue("1.0.0");
    shellOpenPathMock.mockResolvedValue("");
    execFileSyncMock.mockReturnValue(String(2 * ONE_GB));
    backupDatabaseMock.mockImplementation(async (targetPath: string) => {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, "backup");
    });
    validateSqliteBackupMock.mockImplementation(() => undefined);
    getActiveOrdersMock.mockReturnValue([]);
    listPrintJobsMock.mockReturnValue([]);
    getSettingMock.mockImplementation((key: string) =>
      key === "config:printers"
        ? { kitchenPrinterIp: "192.168.1.10", counterPrinterIp: "192.168.1.11" }
        : {},
    );
    mockCountDb();
    delete process.env.POS_UPDATE_MANIFEST_URL;
    delete process.env.POS_ROLLBACK_INSTALLER_URL;
    delete process.env.POS_ROLLBACK_INSTALLER_SHA256;
  });

  afterEach(() => {
    restoreEnv("LOCALAPPDATA", originalLocalAppData);
    restoreEnv("POS_UPDATE_MANIFEST_URL", originalManifestUrl);
    restoreEnv("POS_ROLLBACK_INSTALLER_URL", originalRollbackUrl);
    restoreEnv("POS_ROLLBACK_INSTALLER_SHA256", originalRollbackSha);
  });

  it("compares semantic versions", () => {
    expect(compareVersions("1.1.0", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("validates manifest version, HTTPS installer URL, and SHA256 presence", () => {
    expect(validateManifest(validManifest())).toMatchObject({
      version: "1.1.0",
      installerUrl: "https://updates.example.com/RestaurantPOS-1.1.0.exe",
      sha256: sha256("target-installer"),
    });

    expect(() => validateManifest(validManifest({ version: "latest" }))).toThrow("invalid-version");
    expect(() => validateManifest(validManifest({ installerUrl: "http://updates.example.com/app.exe" }))).toThrow(
      "installer-url-must-use-https",
    );
    expect(() => validateManifest(validManifest({ sha256: "" }))).toThrow("installer-sha256-required");
  });

  it("enforces HTTPS for the manifest URL before downloading", async () => {
    const { service } = createService();
    process.env.POS_UPDATE_MANIFEST_URL = "http://updates.example.com/manifest.json";

    await expect(service.checkForUpdates()).rejects.toThrow("manifest-url-must-use-https");
  });

  it("uses the V1 disk-space formula and blocks insufficient free space", () => {
    const { service, dbPath } = createService();
    fs.writeFileSync(dbPath, Buffer.alloc(1024));
    execFileSyncMock.mockReturnValue(String(2 * ONE_GB));

    const disk = service.validateDiskSpace(validManifest({ installerSizeBytes: 2048 }));

    expect(disk.required).toBe(ONE_GB);
    execFileSyncMock.mockReturnValue("100");
    expect(() => service.validateDiskSpace(validManifest({ installerSizeBytes: 2048 }))).toThrow(
      "insufficient-disk-space",
    );
  });

  it("warns and stops prepare when business activity exists", async () => {
    const { service } = createService();
    writeManifest(service, validManifest());
    getActiveOrdersMock.mockReturnValue([{ kotStatus: "pending" }]);
    listPrintJobsMock.mockImplementation((status?: string) => (status === "failed" ? [{}] : []));

    await expect(service.prepareUpdate()).resolves.toMatchObject({
      ok: false,
      reason: "business-activity",
      businessActivity: {
        openOrders: 1,
        pendingKots: 1,
        failedPrintJobs: 1,
        hasActivity: true,
      },
    });
    expect(backupDatabaseMock).not.toHaveBeenCalled();
  });

  it("prepares an update only after backup and both installers are verified", async () => {
    const { service, paths } = createService();
    const manifest = validManifest();
    writeManifest(service, manifest);
    fs.writeFileSync(paths.installer, "target-installer");
    fs.writeFileSync(paths.rollbackInstaller, "rollback-installer");

    const result = await service.prepareUpdate({ allowBusinessActivity: true });

    expect(result).toMatchObject({ ok: true, state: { status: "prepared", targetVersion: "1.1.0" } });
    expect(backupDatabaseMock).toHaveBeenCalledWith(paths.preUpdateBackup);
    expect(validateSqliteBackupMock).toHaveBeenCalledWith(paths.preUpdateBackup);
    expect(fs.existsSync(paths.instructions)).toBe(true);
    expect(service.readState()).toMatchObject({
      status: "prepared",
      targetInstallerPath: paths.installer,
      rollbackInstallerPath: paths.rollbackInstaller,
      preUpdateBackupPath: paths.preUpdateBackup,
    });
  });

  it("blocks installer launch when the rollback installer is missing or unverified", async () => {
    const { service, paths } = createService();
    fs.writeFileSync(paths.installer, "target-installer");
    fs.writeFileSync(paths.preUpdateBackup, "backup");
    service.writeState({
      status: "prepared",
      targetInstallerPath: paths.installer,
      targetInstallerSha256: sha256("target-installer"),
      rollbackInstallerPath: paths.rollbackInstaller,
      rollbackInstallerSha256: sha256("rollback-installer"),
      preUpdateBackupPath: paths.preUpdateBackup,
    });

    await expect(service.launchPreparedUpdate()).rejects.toThrow("rollback-installer-invalid");
    expect(shellOpenPathMock).not.toHaveBeenCalled();
  });

  it("marks startup verification successful after database and print queue checks pass", () => {
    const { service } = createService();
    const db = mockCountDb();
    service.writeState({ status: "installing", previousVersion: "0.9.0", targetVersion: "1.0.0" });

    expect(service.processStartupState()).toMatchObject({ status: "successful", healthResult: "successful" });
    expect(db.pragma).toHaveBeenCalledWith("integrity_check", { simple: true });
    expect(db.prepare).toHaveBeenCalledWith("SELECT COUNT(*) AS count FROM print_jobs");
    expect(listPrintJobsMock).toHaveBeenCalledWith("pending");
    expect(listPrintJobsMock).toHaveBeenCalledWith("failed");
  });

  it("marks startup verification successful with warnings for missing printers or queued jobs", () => {
    const { service } = createService();
    mockCountDb();
    getSettingMock.mockReturnValue({});
    listPrintJobsMock.mockImplementation((status?: string) => (status === "pending" ? [{}] : []));
    service.writeState({ status: "installing", previousVersion: "0.9.0", targetVersion: "1.0.0" });

    const state = service.processStartupState();

    expect(state).toMatchObject({ status: "warning", healthResult: "warning" });
    expect(state.healthWarnings).toEqual(
      expect.arrayContaining([
        "Kitchen printer is not configured.",
        "Counter printer is not configured.",
        "1 pending print job(s) remain in the queue.",
      ]),
    );
  });

  it("reports rollback unavailable without verified artifacts", () => {
    const { service } = createService();

    expect(service.getStatus().rollbackAvailable).toBe(false);
  });

  it("requires rollback confirmation before replacing the DB and launching rollback installer", async () => {
    const { service, paths } = createService();
    fs.writeFileSync(paths.rollbackInstaller, "rollback-installer");
    fs.writeFileSync(paths.preUpdateBackup, "backup");
    mockCountDb({ orders: 2, payments: 1, paidOrders: 1 });
    service.writeState({
      status: "successful",
      rollbackInstallerPath: paths.rollbackInstaller,
      rollbackInstallerSha256: sha256("rollback-installer"),
      preUpdateBackupPath: paths.preUpdateBackup,
      installStartedAt: 1000,
    });

    await expect(service.rollbackLast()).resolves.toMatchObject({
      ok: false,
      reason: "confirmation-required",
      risk: { orders: 2, payments: 1, paidOrders: 1 },
    });

    await expect(service.rollbackLast({ confirmed: true })).resolves.toMatchObject({
      ok: true,
      risk: { orders: 2, payments: 1, paidOrders: 1 },
    });
    expect(backupDatabaseMock).toHaveBeenLastCalledWith(paths.emergencyBackup);
    expect(replaceDatabaseMock).toHaveBeenCalledWith(paths.preUpdateBackup);
    expect(backupDatabaseMock.mock.invocationCallOrder[0]).toBeLessThan(
      replaceDatabaseMock.mock.invocationCallOrder[0],
    );
    expect(shellOpenPathMock).toHaveBeenCalledWith(paths.rollbackInstaller);
    expect(appQuitMock).toHaveBeenCalled();
  });
});
