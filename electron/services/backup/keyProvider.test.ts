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
});
