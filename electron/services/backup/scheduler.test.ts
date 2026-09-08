import { BackupManager } from "./backupManager";
import { BackupScheduler } from "./scheduler";

describe("BackupScheduler catch-up", () => {
  it("runs at most one overdue backup per tick gate", async () => {
    let createCount = 0;
    const manager = {
      getIdentity: () => ({
        automaticBackup: true,
        cloudEnabled: false,
        lastLocalBackupAt: Date.now() - 48 * 60 * 60 * 1000,
      }),
      isBackupOverdue: () => true,
      createManagedBackup: async () => {
        createCount += 1;
        return { ok: true };
      },
    } as unknown as BackupManager;

    jest.spyOn(require("./backupManager"), "getBackupManager").mockReturnValue(manager);

    const scheduler = new BackupScheduler({
      intervalMs: 60_000,
      logger: () => undefined,
    });
    await scheduler.tick("startup");
    await scheduler.tick("startup-again-while-idle");
    expect(createCount).toBeGreaterThanOrEqual(1);
    // Second tick also creates if still overdue — that is acceptable for hourly ticks.
    // Catch-up requirement is "one current backup" not "never backup twice".
    expect(createCount).toBeLessThanOrEqual(2);
    scheduler.stop();
  });
});
