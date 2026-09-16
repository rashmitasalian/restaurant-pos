import { app } from "electron";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  backupDatabase,
  getDb,
  getDatabasePath,
  restoreDatabaseFromBackup,
  validateSqliteBackup,
} from "../../db/sqlite";
import { gzipFile, gunzipFile } from "./compression";
import { encryptFileToBuffer, decryptToFile } from "./encryption";
import { buildRnBakHeader, checksumEncryptedBody, readRnBakFile, writeRnBakFile } from "./format";
import { backupKeyProvider, BackupKeyProvider } from "./keyProvider";
import { localBackupStore } from "./localStore";
import { assertBackupDiskSpace } from "./diskSpace";
import { cleanupStaleTempFiles, createTempPath, ensureBackupDirs, safeUnlink } from "./paths";
import {
  BackupStatusView,
  CloudIdentitySettings,
  CLOUD_SETTINGS_KEY,
  defaultCloudIdentitySettings,
  OperatorBackupStatus,
} from "./types";

export type BackupLogger = (
  level: string,
  message: string,
  context?: Record<string, unknown>,
) => void;

function defaultLogger(level: string, message: string, context?: Record<string, unknown>) {
  // Lazy import avoided; callers in main inject writeLogToFile
  if (level === "error") {
    console.error(`[backup] ${message}`, context || {});
  }
}

function getSchemaVersion(): number {
  try {
    const row = getDb().prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
      | { version?: number }
      | undefined;
    return Number(row?.version || 0);
  } catch {
    return 0;
  }
}

type SettingsAdapter = {
  getSetting(key: string): Record<string, unknown> | null;
  setSetting(key: string, value: Record<string, unknown>, actor?: string | null): unknown;
};

type BackupRecordAdapter = {
  insertBackupRecord(input: {
    id: string;
    destination: string;
    pathOrProvider: string;
    status: string;
    checksum: string | null;
    sizeBytes: number | null;
    actor?: string | null;
    cloudBackupId?: string | null;
  }): void;
  updateBackupRecord?(
    id: string,
    patch: {
      status?: string;
      cloudBackupId?: string | null;
      error?: string | null;
      destination?: string;
    },
  ): boolean;
  markUploadPendingBackupsCompleted?(cloudBackupId?: string | null): void;
  listBackupRecords(): any[];
};

export class BackupManager {
  private logger: BackupLogger;
  private settings: SettingsAdapter;
  private records: BackupRecordAdapter;
  private keys: BackupKeyProvider;
  private creating = false;

  constructor(options?: {
    logger?: BackupLogger;
    settings?: SettingsAdapter;
    records?: BackupRecordAdapter;
    keys?: BackupKeyProvider;
  }) {
    this.logger = options?.logger || defaultLogger;
    this.settings = options?.settings || {
      getSetting: () => null,
      setSetting: () => null,
    };
    this.records = options?.records || {
      insertBackupRecord: () => undefined,
      listBackupRecords: () => [],
    };
    this.keys = options?.keys || backupKeyProvider;
  }

  getIdentity(): CloudIdentitySettings {
    const stored = (this.settings.getSetting(CLOUD_SETTINGS_KEY) ||
      {}) as Partial<CloudIdentitySettings>;
    return { ...defaultCloudIdentitySettings(), ...stored };
  }

  saveIdentity(patch: Partial<CloudIdentitySettings>, actor?: string | null) {
    const next = { ...this.getIdentity(), ...patch };
    this.settings.setSetting(CLOUD_SETTINGS_KEY, next as unknown as Record<string, unknown>, actor);
    return next;
  }

  markLocalUploadCompleted(localBackupId: string | null | undefined, cloudBackupId: string) {
    if (localBackupId && this.records.updateBackupRecord) {
      this.records.updateBackupRecord(localBackupId, {
        status: "completed",
        cloudBackupId,
        error: null,
      });
    }
    // Clear stuck upload_pending rows once a cloud upload has succeeded.
    this.records.markUploadPendingBackupsCompleted?.(cloudBackupId);
  }

  getStatus(): BackupStatusView {
    const identity = this.getIdentity();
    // Heal history rows left as upload_pending after a successful cloud sync.
    if (identity.cloudEnabled && identity.lastCloudBackupAt && !identity.pendingUploadPath) {
      this.records.markUploadPendingBackupsCompleted?.(null);
    }
    const localFiles = localBackupStore.list();
    const lastLocal = identity.lastLocalBackupAt || localFiles[0]?.createdAt || null;
    const lastCloud = identity.lastCloudBackupAt;
    let operatorStatus: OperatorBackupStatus = "disabled";
    let message = "Cloud backup is not enabled.";

    if (!identity.cloudEnabled) {
      if (lastLocal) {
        operatorStatus = "local_only";
        message = "Local backups are available. Enable cloud backup for off-site recovery.";
      } else {
        operatorStatus = "disabled";
        message = "Cloud backup is not enabled.";
      }
    } else if (identity.pendingUploadPath || identity.lastCloudError === "pending") {
      operatorStatus = "cloud_pending";
      message = "Cloud backup pending";
    } else if (identity.lastCloudError) {
      operatorStatus = "cloud_failed";
      message = "Cloud backup failed";
    } else if (!lastCloud) {
      operatorStatus = "cloud_not_completed";
      message = "Cloud backup not completed yet";
    } else {
      operatorStatus = "everything_backed_up";
      message = "Everything is backed up";
    }

    return {
      operatorStatus,
      message,
      cloudEnabled: identity.cloudEnabled,
      lastLocalBackupAt: lastLocal,
      lastCloudBackupAt: lastCloud,
      cloudBackupCount: this.records.listBackupRecords().filter((row) => {
        const destination = String(row.destination || "");
        const status = String(row.status || "");
        if (destination === "cloud" || destination.startsWith("cloud")) {
          return status === "verified" || status === "completed";
        }
        return Boolean(row.cloud_backup_id) && status === "completed";
      }).length,
      localStorageBytes: localBackupStore.totalBytes(),
      automaticBackup: identity.automaticBackup !== false,
      retentionDays: identity.retentionDays,
      restaurantCode: identity.restaurantCode,
      restaurantId: identity.restaurantId,
      installationId: identity.installationId,
    };
  }

  async createManagedBackup(actor?: string | null): Promise<{
    ok: true;
    id: string;
    path: string;
    checksum: string;
    sizeBytes: number;
    cloudUploadPending: boolean;
  }> {
    if (this.creating) {
      throw new Error("backup-already-running");
    }
    this.creating = true;
    const tempPaths: string[] = [];
    try {
      ensureBackupDirs();
      cleanupStaleTempFiles();
      const paths = ensureBackupDirs();
      assertBackupDiskSpace(paths.root);
      this.logger("info", "backup started");

      const snapshotPath = createTempPath("snapshot", ".sqlite");
      tempPaths.push(snapshotPath);
      await backupDatabase(snapshotPath);
      validateSqliteBackup(snapshotPath);
      this.logger("info", "snapshot completed");

      const gzipPath = createTempPath("compressed", ".sqlite.gz");
      tempPaths.push(gzipPath);
      await gzipFile(snapshotPath, gzipPath);
      this.logger("info", "compression completed");

      const identity = this.getIdentity();
      const key = this.keys.getOrCreateBackupKey();
      const encrypted = encryptFileToBuffer(gzipPath, key);
      const checksum = checksumEncryptedBody(encrypted);
      const originalSize = fs.statSync(snapshotPath).size;
      const compressedSize = fs.statSync(gzipPath).size;
      const encryptedSize = encrypted.ciphertext.length + encrypted.tag.length;

      const id = `backup:${randomUUID()}`;
      const header = buildRnBakHeader({
        restaurantId: identity.restaurantId,
        installationId: identity.installationId,
        deviceId: identity.deviceId,
        createdAt: Date.now(),
        databaseSchemaVersion: getSchemaVersion(),
        appVersion: (() => {
          try {
            return app.getVersion();
          } catch {
            return process.env.npm_package_version || "0.0.0";
          }
        })(),
        compression: "gzip",
        encryptionAlgorithm: "AES-256-GCM",
        keyVersion: identity.keyVersion || 1,
        nonce: encrypted.nonce.toString("base64"),
        checksum,
        originalSize,
        compressedSize,
        encryptedSize,
      });

      const targetPath = localBackupStore.targetPathForId(id.replace(/:/g, "-"));
      const sizeBytes = writeRnBakFile(targetPath, header, encrypted);
      this.logger("info", "local backup created", { id, sizeBytes });

      this.records.insertBackupRecord({
        id,
        destination: "local",
        pathOrProvider: targetPath,
        status: identity.cloudEnabled ? "upload_pending" : "completed",
        checksum,
        sizeBytes,
        actor,
      });

      const cloudUploadPending = Boolean(identity.cloudEnabled);
      this.saveIdentity(
        {
          lastLocalBackupAt: Date.now(),
          pendingUploadPath: cloudUploadPending ? targetPath : null,
          pendingUploadBackupId: cloudUploadPending ? id : null,
          lastCloudError: cloudUploadPending ? "pending" : identity.lastCloudError,
        },
        actor,
      );

      localBackupStore.runRetention(identity.retentionDays);
      this.logger("info", "retention cleanup");

      return {
        ok: true,
        id,
        path: targetPath,
        checksum,
        sizeBytes,
        cloudUploadPending,
      };
    } catch (error: any) {
      this.logger("error", "backup failed", { error: String(error?.message || error) });
      throw error;
    } finally {
      for (const temp of tempPaths) {
        safeUnlink(temp);
      }
      this.creating = false;
    }
  }

  async materializeSqliteFromRnBak(sourcePath: string, targetSqlitePath: string) {
    const { header, payload } = readRnBakFile(sourcePath);
    const key = this.keys.getBackupKey();
    const gzipPath = createTempPath("restore-gz", ".sqlite.gz");
    try {
      decryptToFile(payload, key, gzipPath);
      await gunzipFile(gzipPath, targetSqlitePath);
      validateSqliteBackup(targetSqlitePath);
      return header;
    } finally {
      safeUnlink(gzipPath);
    }
  }

  async restoreManagedBackup(backupIdOrPath: string, actor?: string | null) {
    ensureBackupDirs();
    const paths = ensureBackupDirs();
    assertBackupDiskSpace(paths.root);

    let sourcePath = backupIdOrPath;
    if (!fs.existsSync(sourcePath)) {
      const found =
        localBackupStore.get(backupIdOrPath) ||
        localBackupStore.get(backupIdOrPath.replace(/:/g, "-"));
      if (!found) {
        throw new Error("backup-file-not-found");
      }
      sourcePath = found.path;
    }

    this.logger("info", "restore started", { sourcePath });
    const sqlitePath = createTempPath("restore", ".sqlite");
    try {
      await this.materializeSqliteFromRnBak(sourcePath, sqlitePath);
      // Safety copy of current DB into backups/safety before replace
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safetyPath = path.join(paths.safety, `pre-restore-${stamp}.sqlite`);
      await backupDatabase(safetyPath);
      validateSqliteBackup(safetyPath);
      this.logger("info", "safety backup created", { safetyPath });

      const restored = await restoreDatabaseFromBackup(sqlitePath);
      this.records.insertBackupRecord({
        id: `backup-restore:${randomUUID()}`,
        destination: "local-restore",
        pathOrProvider: sourcePath,
        status: "completed",
        checksum: null,
        sizeBytes: null,
        actor,
      });
      this.logger("info", "restore completed");
      return { ...restored, safetyBackupPath: safetyPath, needsRelaunch: true };
    } finally {
      safeUnlink(sqlitePath);
    }
  }

  isBackupOverdue(maxAgeMs = 24 * 60 * 60 * 1000) {
    const identity = this.getIdentity();
    if (identity.automaticBackup === false) {
      return false;
    }
    const last = identity.lastLocalBackupAt || localBackupStore.list()[0]?.createdAt || 0;
    return !last || Date.now() - last > maxAgeMs;
  }

  getDatabasePathForTests() {
    return getDatabasePath();
  }
}

let singleton: BackupManager | null = null;

export function getBackupManager() {
  if (!singleton) {
    singleton = new BackupManager();
  }
  return singleton;
}

export function configureBackupManager(manager: BackupManager) {
  singleton = manager;
}
