import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { getDatabasePath } from "../../db/sqlite";

export function getFreeSpaceBytes(targetDir: string) {
  if (process.platform !== "win32") {
    try {
      const { freemem } = require("os") as typeof import("os");
      // Non-Windows CI: prefer fs.statfs when available (Node 18.15+/19.6+)
      const statfs = (fs as any).statfsSync as
        | undefined
        | ((p: string) => { bavail: number; bsize: number });
      if (typeof statfs === "function") {
        const info = statfs(path.resolve(targetDir));
        return Number(info.bavail) * Number(info.bsize);
      }
      return Math.max(freemem(), 2 * 1024 * 1024 * 1024);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }
  const root = path.parse(path.resolve(targetDir)).root.replace(/\\$/, "");
  const command = `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${root.replace(/'/g, "''")}'"; [Console]::Out.Write($d.FreeSpace)`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const free = Number(output);
  if (!Number.isFinite(free) || free <= 0) {
    throw new Error("disk-space-unavailable");
  }
  return free;
}

/** Require roughly 3× DB size for snapshot + gzip + encrypted copies. */
export function assertBackupDiskSpace(targetDir: string) {
  const dbPath = getDatabasePath();
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const required = Math.max(dbSize * 3, 64 * 1024 * 1024);
  const free = getFreeSpaceBytes(targetDir);
  if (free < required) {
    throw new Error("insufficient-disk-space");
  }
  return { required, free, dbSize };
}
