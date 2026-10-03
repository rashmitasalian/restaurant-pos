import fs from "fs";
import path from "path";

const MAX_LICENSE_BYTES = 65_536;

export function licenseFilePath(userDataDir: string): string {
  return path.join(userDataDir, "license", "license.rnlc");
}

/** Returns null when no license file exists. An unreadable or oversized file returns "" (malformed). */
export function readLicenseText(userDataDir: string): string | null {
  const filePath = licenseFilePath(userDataDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LICENSE_BYTES) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function writeLicenseText(userDataDir: string, text: string) {
  const filePath = licenseFilePath(userDataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
  try {
    // renameSync replaces an existing license in one step; never delete it first.
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}
