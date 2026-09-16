export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_EXTENSION = ".rnbak";
export const DEFAULT_RETENTION_DAYS = 14;

export type BackupDestination = "local" | "cloud" | "local-restore" | "cloud-restore" | "safety";

export type BackupLifecycleStatus =
  | "creating"
  | "local_stored"
  | "upload_pending"
  | "uploading"
  | "verified"
  | "failed"
  | "completed";

export type OperatorBackupStatus =
  | "everything_backed_up"
  | "cloud_pending"
  | "cloud_failed"
  | "cloud_not_completed"
  | "local_only"
  | "disabled";

export type RnBakHeader = {
  backupFormatVersion: number;
  restaurantId: string | null;
  installationId: string | null;
  deviceId: string | null;
  createdAt: number;
  databaseSchemaVersion: number;
  appVersion: string;
  compression: "gzip";
  encryptionAlgorithm: "AES-256-GCM";
  keyVersion: number;
  nonce: string;
  checksum: string;
  originalSize: number;
  compressedSize: number;
  encryptedSize: number;
};

export type LocalBackupRecord = {
  id: string;
  path: string;
  checksum: string;
  sizeBytes: number;
  createdAt: number;
  destination: BackupDestination;
  status: BackupLifecycleStatus;
  cloudBackupId?: string | null;
  error?: string | null;
};

export type BackupStatusView = {
  operatorStatus: OperatorBackupStatus;
  message: string;
  cloudEnabled: boolean;
  lastLocalBackupAt: number | null;
  lastCloudBackupAt: number | null;
  cloudBackupCount: number;
  localStorageBytes: number;
  automaticBackup: boolean;
  retentionDays: number;
  restaurantCode: string | null;
  restaurantId: string | null;
  installationId: string | null;
};

export type CloudIdentitySettings = {
  restaurantId: string | null;
  installationId: string | null;
  deviceId: string | null;
  restaurantCode: string | null;
  cloudEnabled: boolean;
  automaticBackup: boolean;
  retentionDays: number;
  lastLocalBackupAt: number | null;
  lastCloudBackupAt: number | null;
  lastCloudError: string | null;
  pendingUploadPath: string | null;
  pendingUploadBackupId: string | null;
  keyVersion: number;
};

export const CLOUD_SETTINGS_KEY = "config:cloud-backup";

export function defaultCloudIdentitySettings(): CloudIdentitySettings {
  return {
    restaurantId: null,
    installationId: null,
    deviceId: null,
    restaurantCode: null,
    cloudEnabled: false,
    automaticBackup: true,
    retentionDays:
      Number(process.env.POS_BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS) ||
      DEFAULT_RETENTION_DAYS,
    lastLocalBackupAt: null,
    lastCloudBackupAt: null,
    lastCloudError: null,
    pendingUploadPath: null,
    pendingUploadBackupId: null,
    keyVersion: 1,
  };
}
