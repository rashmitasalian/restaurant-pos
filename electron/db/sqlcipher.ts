import fs from "fs";
import path from "path";
import { isPlaintextSqliteFile, loadOrCreateDatabaseKey, restrictFileToCurrentUser } from "./databaseKey";

type SqliteDatabase = any;

function loadCipherDatabase() {
  try {
    return require("better-sqlite3-multiple-ciphers");
  } catch (error: any) {
    const failure = new Error("database-encryption-unavailable");
    (failure as Error & { cause?: unknown }).cause = error;
    throw failure;
  }
}

function sqlcipherKeyLiteral(key: Buffer) {
  const hex = key.toString("hex");
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("invalid-database-key");
  }
  return `x'${hex}'`;
}

/** Cipher selection, then the key, before any application pragma. */
export function applySqlCipherKey(database: SqliteDatabase, key: Buffer) {
  const literal = sqlcipherKeyLiteral(key);
  database.pragma("cipher='sqlcipher'");
  database.pragma("legacy=4");
  database.pragma(`key="${literal}"`);
}

function removeSidecars(databasePath: string) {
  for (const suffix of ["-wal", "-shm"]) {
    const file = `${databasePath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

function checkpointPlaintext(databasePath: string) {
  const Cipher = loadCipherDatabase();
  const database = new Cipher(databasePath);
  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}

function encryptCopy(sourcePath: string, targetPath: string, key: Buffer) {
  fs.copyFileSync(sourcePath, targetPath);
  const Cipher = loadCipherDatabase();
  const database = new Cipher(targetPath);
  try {
    const literal = sqlcipherKeyLiteral(key);
    database.pragma("cipher='sqlcipher'");
    database.pragma("legacy=4");
    database.pragma(`rekey="${literal}"`);
  } finally {
    database.close();
  }
}

function assertEncryptedOpens(databasePath: string, key: Buffer) {
  const Cipher = loadCipherDatabase();
  const database = new Cipher(databasePath);
  try {
    applySqlCipherKey(database, key);
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error("database-migration-failed");
    }
    database.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
  } finally {
    database.close();
  }
}

/**
 * Writes an encrypted copy, checks it, and only then replaces the live file.
 * The plaintext original is removed after that encrypted file opens.
 */
export function migratePlaintextDatabase(databasePath: string, key: Buffer) {
  const directory = path.dirname(databasePath);
  const stamp = Date.now();
  const encryptedTemp = path.join(directory, `.${path.basename(databasePath)}.${stamp}.encrypting`);
  const plaintextHold = path.join(directory, `.${path.basename(databasePath)}.${stamp}.plaintext`);
  checkpointPlaintext(databasePath);
  try {
    encryptCopy(databasePath, encryptedTemp, key);
    assertEncryptedOpens(encryptedTemp, key);
  } catch (error) {
    if (fs.existsSync(encryptedTemp)) {
      fs.unlinkSync(encryptedTemp);
    }
    if (error instanceof Error && error.message === "database-migration-failed") {
      throw error;
    }
    throw new Error("database-migration-failed");
  }

  removeSidecars(databasePath);
  try {
    fs.renameSync(databasePath, plaintextHold);
  } catch {
    fs.unlinkSync(encryptedTemp);
    throw new Error("database-migration-failed");
  }
  restrictFileToCurrentUser(plaintextHold);
  try {
    fs.renameSync(encryptedTemp, databasePath);
    assertEncryptedOpens(databasePath, key);
  } catch (error) {
    if (fs.existsSync(databasePath)) {
      fs.unlinkSync(databasePath);
    }
    if (fs.existsSync(plaintextHold)) {
      fs.renameSync(plaintextHold, databasePath);
    }
    if (fs.existsSync(encryptedTemp)) {
      fs.unlinkSync(encryptedTemp);
    }
    if (error instanceof Error && error.message === "database-migration-failed") {
      throw error;
    }
    throw new Error("database-migration-failed");
  }

  fs.unlinkSync(plaintextHold);
  removeSidecars(plaintextHold);
}

function sqliteString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function removeSnapshotFiles(filePath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${filePath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

/**
 * The online backup API refuses an encrypted source and a plaintext destination.
 * VACUUM INTO copies the open database with its current key. Rekeying that copy
 * with an empty key produces the plaintext snapshot the backup file expects.
 */
export function exportPlaintextSnapshot(database: SqliteDatabase, targetPath: string, key: Buffer) {
  const resolved = path.resolve(targetPath);
  const staging = `${resolved}.encrypted-snapshot`;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  removeSnapshotFiles(resolved);
  removeSnapshotFiles(staging);
  const sqlPath = staging.replace(/\\/g, "/");
  database.exec(`VACUUM INTO ${sqliteString(sqlPath)}`);
  const Cipher = loadCipherDatabase();
  const snapshot = new Cipher(staging);
  try {
    applySqlCipherKey(snapshot, key);
    snapshot.pragma("rekey=''");
  } catch (error) {
    snapshot.close();
    removeSnapshotFiles(staging);
    throw error;
  }
  snapshot.close();
  try {
    fs.renameSync(staging, resolved);
  } catch (error) {
    removeSnapshotFiles(staging);
    throw error;
  }
}

export function openPosDatabase(databasePath: string): SqliteDatabase {
  const Cipher = loadCipherDatabase();
  const key = loadOrCreateDatabaseKey(databasePath);
  const exists = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
  if (exists && isPlaintextSqliteFile(databasePath)) {
    migratePlaintextDatabase(databasePath, key);
  }
  const database = new Cipher(databasePath);
  try {
    applySqlCipherKey(database, key);
    if (exists) {
      const integrity = database.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        throw new Error("database-integrity-failed");
      }
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}
