import { app } from "electron";
import fs from "fs";
import path from "path";

export type BackupPaths = {
  root: string;
  local: string;
  safety: string;
  temp: string;
  cloudSecrets: string;
};

export function getBackupPaths(): BackupPaths {
  const root = path.join(app.getPath("userData"), "backups");
  return {
    root,
    local: path.join(root, "local"),
    safety: path.join(root, "safety"),
    temp: path.join(root, "temp"),
    cloudSecrets: path.join(app.getPath("userData"), "cloud"),
  };
}

export function ensureBackupDirs() {
  const paths = getBackupPaths();
  for (const dir of [paths.root, paths.local, paths.safety, paths.temp, paths.cloudSecrets]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

export function createTempPath(prefix: string, extension = "") {
  const paths = ensureBackupDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(paths.temp, `${prefix}-${stamp}-${process.pid}${extension}`);
}

export function cleanupStaleTempFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
  const paths = ensureBackupDirs();
  const now = Date.now();
  if (!fs.existsSync(paths.temp)) {
    return 0;
  }
  let removed = 0;
  for (const name of fs.readdirSync(paths.temp)) {
    const full = path.join(paths.temp, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        continue;
      }
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {
      // ignore locked/missing files
    }
  }
  return removed;
}

export function safeUnlink(filePath: string | null | undefined) {
  if (!filePath) {
    return;
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}
