import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const SQLITE_HEADER = "SQLite format 3\0";

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

function getSafeStorage(): SafeStorageLike {
  try {
    const electron = require("electron") as { safeStorage?: SafeStorageLike };
    if (electron.safeStorage) {
      return electron.safeStorage;
    }
  } catch {
    // Jest and other non-Electron runs.
  }
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (encrypted: Buffer) => encrypted.toString("utf8"),
  };
}

export function databaseKeyPath(databasePath: string) {
  return `${databasePath}.key`;
}

export function isPlaintextSqliteFile(filePath: string) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  if (fs.statSync(filePath).size < SQLITE_HEADER.length) {
    return false;
  }
  const header = Buffer.alloc(SQLITE_HEADER.length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.toString("utf8") === SQLITE_HEADER;
}

export function restrictFileToCurrentUser(filePath: string) {
  try {
    if (process.platform === "win32") {
      const user = os.userInfo().username;
      execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${user}:(F)`], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Tightening the ACL is best-effort. A failed migration still keeps the original file.
  }
}

function readKeyFile(filePath: string): Buffer | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const storage = getSafeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new Error("secure-storage-unavailable");
  }
  const decoded = storage.decryptString(fs.readFileSync(filePath));
  const key = Buffer.from(decoded, "base64");
  if (key.length !== 32) {
    throw new Error("invalid-database-key");
  }
  return key;
}

function writeKeyFile(filePath: string, key: Buffer) {
  const storage = getSafeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new Error("secure-storage-unavailable");
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, storage.encryptString(key.toString("base64")));
  restrictFileToCurrentUser(filePath);
}

/** Random 32-byte key. Created once and wrapped with the Windows safeStorage key. */
export function loadOrCreateDatabaseKey(databasePath: string): Buffer {
  const filePath = databaseKeyPath(databasePath);
  const existing = readKeyFile(filePath);
  if (existing) {
    return existing;
  }
  const databaseExists = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
  if (databaseExists && !isPlaintextSqliteFile(databasePath)) {
    throw new Error("database-key-missing");
  }
  const key = randomBytes(32);
  writeKeyFile(filePath, key);
  return key;
}
