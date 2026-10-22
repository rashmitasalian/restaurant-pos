import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { BackupKeyProvider } from "./keyProvider";
import { createRecoveryMaterial, normalizeRecoveryKey, unwrapBackupKey } from "./recoveryKey";

jest.mock("electron", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pos-keyprov-"));
  return {
    app: {
      getPath: jest.fn(() => userData),
      getVersion: jest.fn(() => "0.6.0-test"),
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
      decryptString: (encrypted: Buffer) => encrypted.toString("utf8").slice(4),
    },
  };
});

describe("BackupKeyProvider", () => {
  it("stores backup key and installation token via safeStorage", () => {
    const provider = new BackupKeyProvider();
    provider.ensureDirs();
    const { backupKey, recovery } = provider.createActivationMaterial(1);
    expect(provider.hasBackupKey()).toBe(true);
    expect(provider.getBackupKey().equals(backupKey)).toBe(true);

    const token = randomBytes(24).toString("base64url");
    provider.storeInstallationToken(token);
    expect(provider.getInstallationToken()).toBe(token);

    provider.clearSecrets();
    const restored = unwrapBackupKey(
      recovery.wrappedBackupKey,
      normalizeRecoveryKey(recovery.recoveryKey),
    );
    provider.restoreFromRecovery(recovery.wrappedBackupKey, recovery.recoveryKey);
    expect(provider.getBackupKey().equals(restored)).toBe(true);
  });

  it("creates recovery material that does not embed plaintext key in verifier", () => {
    const material = createRecoveryMaterial();
    expect(material.verifierHash).not.toContain(material.recoveryKey);
    expect(material.wrappedBackupKey).not.toEqual(material.recoveryKey);
    expect(createHash("sha256").update(material.recoveryKey).digest("hex")).not.toBe(
      material.verifierHash,
    );
  });

  it("replaces an unreadable backup-key.enc so new backups can continue", () => {
    const provider = new BackupKeyProvider();
    provider.ensureDirs();
    const first = provider.getOrCreateBackupKey();
    const keyPath = path.join(
      (require("electron") as { app: { getPath: (name: string) => string } }).app.getPath("userData"),
      "cloud",
      "backup-key.enc",
    );
    // Corrupt the on-disk blob so decryptString fails / yields a non-32-byte key.
    fs.writeFileSync(keyPath, Buffer.from("enc:not-a-valid-base64-key"));
    const replaced = provider.getOrCreateBackupKey();
    expect(replaced.length).toBe(32);
    expect(replaced.equals(first)).toBe(false);
    expect(provider.getBackupKey().equals(replaced)).toBe(true);
    const quarantined = fs
      .readdirSync(path.dirname(keyPath))
      .filter((name) => name.startsWith("backup-key.enc.unreadable."));
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
  });
});
