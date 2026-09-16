import { getBackupManager } from "./backupManager";
import { cloudBackupStore } from "./cloudClient";
import { cleanupStaleTempFiles } from "./paths";

export type BackupSchedulerOptions = {
  intervalMs?: number;
  logger?: (level: string, message: string, context?: Record<string, unknown>) => void;
};

/**
 * Daily automatic backup + startup catch-up + pending cloud upload retries.
 * Never throws into the app lifecycle.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private retryAttempt = 0;
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
      if (identity.cloudEnabled) {
        const result = await cloudBackupStore.uploadPendingIfAny(this.logger);
        if (result.ok) {
          this.retryAttempt = 0;
        } else if ((result as any).retryable) {
          this.retryAttempt += 1;
          const delay = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(this.retryAttempt, 6));
          this.logger("info", "retry scheduled", { delayMs: delay });
          setTimeout(() => {
            void this.tick("retry");
          }, delay).unref?.();
        }
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
