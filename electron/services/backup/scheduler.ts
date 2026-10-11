import { getBackupManager } from "./backupManager";
import { cleanupStaleTempFiles } from "./paths";

export type BackupSchedulerOptions = {
  intervalMs?: number;
  logger?: (level: string, message: string, context?: Record<string, unknown>) => void;
};

/**
 * Daily automatic local backup and startup catch-up.
 * Never throws into the app lifecycle.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly logger: (
    level: string,
    message: string,
    context?: Record<string, unknown>,
  ) => void;

  constructor(options?: BackupSchedulerOptions) {
    this.intervalMs = options?.intervalMs || 60 * 60 * 1000; // hourly tick; daily gate inside
    this.logger =
      options?.logger ||
      ((level, message, context) => {
        if (level === "error") {
          console.error(`[backup-scheduler] ${message}`, context || {});
        }
      });
  }

  start() {
    if (this.timer) {
      return;
    }
    cleanupStaleTempFiles();
    void this.tick("startup");
    this.timer = setInterval(() => {
      void this.tick("interval");
    }, this.intervalMs);
    // Do not keep process alive solely for backup timer in tests
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(reason: string) {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const manager = getBackupManager();
      const identity = manager.getIdentity();
      if (identity.automaticBackup !== false && manager.isBackupOverdue()) {
        this.logger("info", "catch-up or daily backup", { reason });
        await manager.createManagedBackup("system:backup-scheduler");
      }
    } catch (error: any) {
      this.logger("error", "scheduler tick failed", {
        error: String(error?.message || error),
        reason,
      });
    } finally {
      this.running = false;
    }
  }
}

let scheduler: BackupScheduler | null = null;

export function startBackupScheduler(options?: BackupSchedulerOptions) {
  if (!scheduler) {
    scheduler = new BackupScheduler(options);
  }
  scheduler.start();
  return scheduler;
}

export function stopBackupScheduler() {
  scheduler?.stop();
  scheduler = null;
}
