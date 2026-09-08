import fs from "fs";
import path from "path";
import { BACKUP_FILE_EXTENSION, DEFAULT_RETENTION_DAYS } from "./types";
import { ensureBackupDirs, getBackupPaths, safeUnlink } from "./paths";
import { readRnBakFile } from "./format";

export type ManagedBackupFile = {
  id: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
  checksum: string;
};

function parseBackupId(fileName: string) {
  const base = fileName.replace(/\.rnbak$/i, "");
  return base;
}

export class LocalBackupStore {
  list(): ManagedBackupFile[] {
    const { local } = ensureBackupDirs();
    if (!fs.existsSync(local)) {
      return [];
    }
    const files = fs
      .readdirSync(local)
      .filter((name) => name.toLowerCase().endsWith(BACKUP_FILE_EXTENSION))
      .map((name) => {
        const full = path.join(local, name);
        const stat = fs.statSync(full);
        let checksum = "";
        try {
          checksum = readRnBakFile(full).header.checksum;
        } catch {
          checksum = "";
        }
        return {
          id: parseBackupId(name),
          path: full,
          createdAt: stat.mtimeMs,
          sizeBytes: stat.size,
          checksum,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return files;
  }

  get(id: string): ManagedBackupFile | null {
    return this.list().find((item) => item.id === id) || null;
  }

  totalBytes() {
    return this.list().reduce((sum, item) => sum + item.sizeBytes, 0);
  }

  targetPathForId(id: string) {
    const { local } = ensureBackupDirs();
    return path.join(local, `${id}${BACKUP_FILE_EXTENSION}`);
  }

  runRetention(retentionDays = DEFAULT_RETENTION_DAYS) {
    const files = this.list();
    if (files.length === 0) {
      return { deleted: 0, kept: 0 };
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const latest = files[0];
    let deleted = 0;
    for (const file of files) {
      if (file.path === latest.path) {
        continue;
      }
      if (!file.checksum) {
        // corrupt/partial — safe to remove if not latest
        safeUnlink(file.path);
        deleted += 1;
        continue;
      }
      if (file.createdAt < cutoff) {
        safeUnlink(file.path);
        deleted += 1;
      }
    }
    return { deleted, kept: this.list().length };
  }

  listSafety() {
    const { safety } = ensureBackupDirs();
    if (!fs.existsSync(safety)) {
      return [];
    }
    return fs
      .readdirSync(safety)
      .filter((name) => name.toLowerCase().endsWith(".sqlite") || name.toLowerCase().endsWith(BACKUP_FILE_EXTENSION))
      .map((name) => path.join(safety, name));
  }
}

export const localBackupStore = new LocalBackupStore();

export function getLocalBackupRoot() {
  return getBackupPaths().local;
}
