/**
 * Disaster recovery flow test (desktop-side crypto + format).
 * Simulates: Installation A creates encrypted backup → wipe secrets →
 * Installation B recovers BackupKey via recovery material → decrypt succeeds.
 * Wrong recovery key fails safely.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { gzipFile, gunzipFile } from "./compression";
import { decryptToFile, encryptFileToBuffer, generateBackupKey } from "./encryption";
import { buildRnBakHeader, checksumEncryptedBody, readRnBakFile, writeRnBakFile } from "./format";
import { BackupKeyProvider } from "./keyProvider";
import { createRecoveryMaterial, normalizeRecoveryKey, unwrapBackupKey } from "./recoveryKey";

jest.mock("electron", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pos-dr-"));
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

describe("disaster recovery key handoff", () => {
  it("allows a new installation to decrypt an old backup with the recovery key", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-dr-files-"));
    const sqliteLike = path.join(dir, "snap.sqlite");
    const gz = path.join(dir, "snap.gz");
    const rnbak = path.join(dir, "backup.rnbak");
    const restoredGz = path.join(dir, "out.gz");
    const restoredSqlite = path.join(dir, "out.sqlite");

    fs.writeFileSync(sqliteLike, Buffer.from("SQLite format 3\0restaurant-data-v1"));
    await gzipFile(sqliteLike, gz);

    const providerA = new BackupKeyProvider();
    const { backupKey, recovery } = providerA.createActivationMaterial(1);
    const encrypted = encryptFileToBuffer(gz, backupKey);
    const checksum = checksumEncryptedBody(encrypted);
    writeRnBakFile(
      rnbak,
      buildRnBakHeader({
        restaurantId: "rest-1",
        installationId: "inst-a",
        deviceId: "dev-a",
        createdAt: Date.now(),
        databaseSchemaVersion: 27,
        appVersion: "0.6.0",
        compression: "gzip",
        encryptionAlgorithm: "AES-256-GCM",
        keyVersion: 1,
        nonce: encrypted.nonce.toString("base64"),
        checksum,
        originalSize: fs.statSync(sqliteLike).size,
        compressedSize: fs.statSync(gz).size,
        encryptedSize: encrypted.ciphertext.length + encrypted.tag.length,
      }),
      encrypted,
    );

    // Destroy installation A secrets
    providerA.clearSecrets();
    expect(providerA.hasBackupKey()).toBe(false);

    // Wrong recovery key cannot unwrap
    expect(() =>
      unwrapBackupKey(
        recovery.wrappedBackupKey,
        normalizeRecoveryKey("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH"),
      ),
    ).toThrow();

    // Installation B recovers
    const providerB = new BackupKeyProvider();
    providerB.restoreFromRecovery(recovery.wrappedBackupKey, recovery.recoveryKey);
    const { header, payload } = readRnBakFile(rnbak);
    expect(header.checksum).toBe(checksum);
    decryptToFile(payload, providerB.getBackupKey(), restoredGz);
    await gunzipFile(restoredGz, restoredSqlite);
    expect(fs.readFileSync(restoredSqlite).equals(fs.readFileSync(sqliteLike))).toBe(true);
  });

  it("rejects wrong recovery material without exposing the backup key", () => {
    const key = generateBackupKey();
    const material = createRecoveryMaterial(key, 1);
    const provider = new BackupKeyProvider();
    provider.clearSecrets();
    expect(() =>
      provider.restoreFromRecovery(
        material.wrappedBackupKey,
        "1111-2222-3333-4444-5555-6666-7777-8888",
      ),
    ).toThrow();
    expect(provider.hasBackupKey()).toBe(false);
  });
});
