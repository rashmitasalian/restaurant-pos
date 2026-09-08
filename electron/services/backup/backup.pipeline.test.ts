import { createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { gzipFile, gunzipFile } from "./compression";
import { decryptBuffer, encryptBuffer, generateBackupKey } from "./encryption";
import { buildRnBakHeader, checksumEncryptedBody, readRnBakFile, writeRnBakFile } from "./format";
import { assertChecksum, sha256Buffer } from "./integrity";
import {
  createRecoveryMaterial,
  normalizeRecoveryKey,
  unwrapBackupKey,
  wrapBackupKey,
  verifyRecoveryKey,
} from "./recoveryKey";
import { LocalBackupStore } from "./localStore";
import { BACKUP_FILE_EXTENSION } from "./types";

jest.mock("electron", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pos-backup-udata-"));
  return {
    app: {
      getPath: jest.fn(() => userData),
      getVersion: jest.fn(() => "0.6.0-test"),
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
      decryptString: (encrypted: Buffer) => {
        const text = encrypted.toString("utf8");
        if (!text.startsWith("enc:")) {
          throw new Error("bad-safe-storage");
        }
        return text.slice(4);
      },
    },
  };
});

describe("backup compression", () => {
  it("round-trips gzip", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-gzip-"));
    const source = path.join(dir, "a.sqlite");
    const gz = path.join(dir, "a.gz");
    const out = path.join(dir, "b.sqlite");
    fs.writeFileSync(source, Buffer.concat([Buffer.from("SQLite format 3\0"), randomBytes(2048)]));
    await gzipFile(source, gz);
    await gunzipFile(gz, out);
    expect(fs.readFileSync(out).equals(fs.readFileSync(source))).toBe(true);
  });
});

describe("backup encryption", () => {
  it("encrypts and decrypts", () => {
    const key = generateBackupKey();
    const plain = Buffer.from("restaurant-data");
    const enc = encryptBuffer(plain, key);
    expect(decryptBuffer(enc, key).equals(plain)).toBe(true);
  });

  it("rejects wrong key", () => {
    const enc = encryptBuffer(Buffer.from("x"), generateBackupKey());
    expect(() => decryptBuffer(enc, generateBackupKey())).toThrow();
  });

  it("rejects corrupted ciphertext", () => {
    const key = generateBackupKey();
    const enc = encryptBuffer(Buffer.from("x"), key);
    enc.ciphertext[0] ^= 0xff;
    expect(() => decryptBuffer(enc, key)).toThrow();
  });
});

describe("backup integrity and format", () => {
  it("writes and reads .rnbak with checksum", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-rnbak-"));
    const target = path.join(dir, `backup-1${BACKUP_FILE_EXTENSION}`);
    const key = generateBackupKey();
    const payload = encryptBuffer(Buffer.from("gzip-bytes"), key);
    const checksum = checksumEncryptedBody(payload);
    const header = buildRnBakHeader({
      restaurantId: "r1",
      installationId: "i1",
      deviceId: "d1",
      createdAt: Date.now(),
      databaseSchemaVersion: 26,
      appVersion: "0.6.0",
      compression: "gzip",
      encryptionAlgorithm: "AES-256-GCM",
      keyVersion: 1,
      nonce: payload.nonce.toString("base64"),
      checksum,
      originalSize: 10,
      compressedSize: 8,
      encryptedSize: payload.ciphertext.length + payload.tag.length,
    });
    writeRnBakFile(target, header, payload);
    const read = readRnBakFile(target);
    expect(read.header.checksum).toBe(checksum);
    expect(decryptBuffer(read.payload, key).toString("utf8")).toBe("gzip-bytes");
  });

  it("rejects modified backup payload", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-rnbak-bad-"));
    const target = path.join(dir, `backup-1${BACKUP_FILE_EXTENSION}`);
    const key = generateBackupKey();
    const payload = encryptBuffer(Buffer.from("gzip-bytes"), key);
    const checksum = checksumEncryptedBody(payload);
    const header = buildRnBakHeader({
      restaurantId: null,
      installationId: null,
      deviceId: null,
      createdAt: Date.now(),
      databaseSchemaVersion: 26,
      appVersion: "0.6.0",
      compression: "gzip",
      encryptionAlgorithm: "AES-256-GCM",
      keyVersion: 1,
      nonce: payload.nonce.toString("base64"),
      checksum,
      originalSize: 10,
      compressedSize: 8,
      encryptedSize: payload.ciphertext.length + payload.tag.length,
    });
    writeRnBakFile(target, header, payload);
    const bytes = fs.readFileSync(target);
    bytes[bytes.length - 5] ^= 0xff;
    fs.writeFileSync(target, bytes);
    expect(() => readRnBakFile(target)).toThrow(/checksum-mismatch|invalid/);
  });

  it("validates checksum helper", () => {
    const hash = sha256Buffer(Buffer.from("abc"));
    expect(hash).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(() => assertChecksum(hash, "00")).toThrow("checksum-mismatch");
  });
});

describe("recovery key", () => {
  it("wraps and unwraps backup key", () => {
    const material = createRecoveryMaterial();
    const backupKey = unwrapBackupKey(material.wrappedBackupKey, material.recoveryKeyNormalized);
    expect(backupKey.length).toBe(32);
    const wrappedAgain = wrapBackupKey(backupKey, normalizeRecoveryKey(material.recoveryKey));
    expect(unwrapBackupKey(wrappedAgain, material.recoveryKeyNormalized).equals(backupKey)).toBe(true);
  });

  it("verifies recovery key against scrypt verifier", () => {
    const material = createRecoveryMaterial();
    const ok = verifyRecoveryKey(material.recoveryKey, {
      hash_algo: material.verifierAlgo,
      salt: material.verifierSalt,
      password_hash: material.verifierHash,
    });
    expect(ok.ok).toBe(true);
    const bad = verifyRecoveryKey("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", {
      hash_algo: material.verifierAlgo,
      salt: material.verifierSalt,
      password_hash: material.verifierHash,
    });
    expect(bad.ok).toBe(false);
  });
});

describe("local backup store retention", () => {
  it("keeps latest and deletes old files", () => {
    const { app } = require("electron") as { app: { getPath: jest.Mock } };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pos-local-store-"));
    app.getPath.mockReturnValue(root);
    const store = new LocalBackupStore();
    const local = path.join(root, "backups", "local");
    fs.mkdirSync(local, { recursive: true });

    const key = generateBackupKey();
    const writeOne = (name: string, ageMs: number) => {
      const payload = encryptBuffer(Buffer.from(name), key);
      const checksum = checksumEncryptedBody(payload);
      const header = buildRnBakHeader({
        restaurantId: null,
        installationId: null,
        deviceId: null,
        createdAt: Date.now() - ageMs,
        databaseSchemaVersion: 1,
        appVersion: "0.6.0",
        compression: "gzip",
        encryptionAlgorithm: "AES-256-GCM",
        keyVersion: 1,
        nonce: payload.nonce.toString("base64"),
        checksum,
        originalSize: 1,
        compressedSize: 1,
        encryptedSize: payload.ciphertext.length + payload.tag.length,
      });
      const full = path.join(local, name);
      writeRnBakFile(full, header, payload);
      const when = Date.now() - ageMs;
      fs.utimesSync(full, when / 1000, when / 1000);
    };

    writeOne(`old${BACKUP_FILE_EXTENSION}`, 30 * 24 * 60 * 60 * 1000);
    writeOne(`new${BACKUP_FILE_EXTENSION}`, 1000);
    const result = store.runRetention(14);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(store.list().some((f) => f.path.endsWith(`new${BACKUP_FILE_EXTENSION}`))).toBe(true);
  });
});
