import fs from "fs";
import path from "path";
import { generateBackupKey } from "./encryption";
import { ensureBackupDirs, getBackupPaths } from "./paths";
import {
  createRecoveryMaterial,
  normalizeRecoveryKey,
  unwrapBackupKey,
  RecoveryMaterial,
} from "./recoveryKey";

const BACKUP_KEY_FILE = "backup-key.enc";
const INSTALL_TOKEN_FILE = "installation-token.enc";

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
    // Jest / non-electron environments
  }
  // Dev/test fallback: obfuscation only (not for production machines without DPAPI)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (encrypted: Buffer) => encrypted.toString("utf8"),
  };
}

function requireSafeStorage(storage: SafeStorageLike) {
  if (!storage.isEncryptionAvailable()) {
    throw new Error("secure-storage-unavailable");
  }
}

function encryptToFile(filePath: string, plaintext: Buffer) {
  const storage = getSafeStorage();
  requireSafeStorage(storage);
  const encrypted = storage.encryptString(plaintext.toString("base64"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encrypted);
}

function decryptFromFile(filePath: string): Buffer | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const storage = getSafeStorage();
  requireSafeStorage(storage);
  const encrypted = fs.readFileSync(filePath);
  const decoded = storage.decryptString(encrypted);
  return Buffer.from(decoded, "base64");
}

export class BackupKeyProvider {
  private backupKeyPath() {
    return path.join(getBackupPaths().cloudSecrets, BACKUP_KEY_FILE);
  }

  private tokenPath() {
    return path.join(getBackupPaths().cloudSecrets, INSTALL_TOKEN_FILE);
  }

  ensureDirs() {
    ensureBackupDirs();
  }

  hasBackupKey() {
    return fs.existsSync(this.backupKeyPath());
  }

  hasInstallationToken() {
    return fs.existsSync(this.tokenPath());
  }

  getBackupKey(): Buffer {
    const key = decryptFromFile(this.backupKeyPath());
    if (!key || key.length !== 32) {
      throw new Error("backup-key-missing");
    }
    return key;
  }

  storeBackupKey(key: Buffer) {
    if (key.length !== 32) {
      throw new Error("invalid-backup-key");
    }
    encryptToFile(this.backupKeyPath(), key);
  }

  getOrCreateBackupKey(): Buffer {
    if (this.hasBackupKey()) {
      try {
        return this.getBackupKey();
      } catch {
        // DPAPI/safeStorage can no longer unwrap this file (Windows profile change,
        // Local State reset, etc.). Quarantine it and mint a fresh key so new backups
        // keep working. Existing .rnbak files encrypted with the old key stay unrestorable
        // without recovery material.
        const brokenPath = this.backupKeyPath();
        const quarantinePath = `${brokenPath}.unreadable.${Date.now()}`;
        try {
          fs.renameSync(brokenPath, quarantinePath);
        } catch {
          try {
            fs.unlinkSync(brokenPath);
          } catch {
            // Fall through and attempt to overwrite below.
          }
        }
      }
    }
    const key = generateBackupKey();
    this.storeBackupKey(key);
    return key;
  }

  storeInstallationToken(token: string) {
    encryptToFile(this.tokenPath(), Buffer.from(token, "utf8"));
  }

  getInstallationToken(): string | null {
    const buf = decryptFromFile(this.tokenPath());
    return buf ? buf.toString("utf8") : null;
  }

  clearSecrets() {
    for (const file of [this.backupKeyPath(), this.tokenPath()]) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch {
        // ignore
      }
    }
  }

  createActivationMaterial(keyVersion = 1): { backupKey: Buffer; recovery: RecoveryMaterial } {
    const backupKey = generateBackupKey();
    const recovery = createRecoveryMaterial(backupKey, keyVersion);
    this.storeBackupKey(backupKey);
    return { backupKey, recovery };
  }

  restoreFromRecovery(wrappedBackupKey: string, recoveryKeyInput: string) {
    const normalized = normalizeRecoveryKey(recoveryKeyInput);
    const backupKey = unwrapBackupKey(wrappedBackupKey, normalized);
    this.storeBackupKey(backupKey);
    return backupKey;
  }
}

export const backupKeyProvider = new BackupKeyProvider();
