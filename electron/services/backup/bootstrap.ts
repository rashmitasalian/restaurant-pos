import { configureBackupManager, BackupManager } from "./backupManager";
import { posService } from "../posService";

export function bootstrapBackupManager(logger?: (level: string, message: string, context?: any) => void) {
  const manager = new BackupManager({
    logger,
    settings: {
      getSetting: (key) => posService.getSetting(key),
      setSetting: (key, value, actor) => posService.setSetting(key, value, actor),
    },
    records: {
      insertBackupRecord: (input) => posService.insertBackupRecord(input),
      updateBackupRecord: (id, patch) => posService.updateBackupRecord(id, patch),
      markUploadPendingBackupsCompleted: (cloudBackupId) =>
        posService.markUploadPendingBackupsCompleted(cloudBackupId),
      listBackupRecords: () => posService.listBackups() as any[],
    },
  });
  configureBackupManager(manager);
  return manager;
}
