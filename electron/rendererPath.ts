import fs from "fs";
import path from "path";

/** True when the path is inside a packed asar (not the sibling unpacked folder). */
export function isInsideAsarArchive(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return /\/app\.asar\//.test(normalized) && !/\/app\.asar\.unpacked\//.test(normalized);
}

/**
 * Production UI must be a real filesystem file. Node can read files inside app.asar,
 * but Chromium file:// cannot when grantFileProtocolExtraPrivileges is disabled.
 */
export function resolveProductionRendererHtml(options: {
  resourcesPath: string;
  dirname: string;
  existsSync?: (filePath: string) => boolean;
}): string {
  const exists = options.existsSync ?? ((filePath: string) => fs.existsSync(filePath));
  const candidates = [
    path.join(options.resourcesPath, "app.asar.unpacked", "dist", "index.html"),
    path.join(options.dirname, "..", "..", "dist", "index.html"),
  ];
  const usable = candidates.find(
    (candidate) => exists(candidate) && !isInsideAsarArchive(candidate),
  );
  if (!usable) {
    throw new Error(`renderer-not-found:${candidates.join("|")}`);
  }
  return usable;
}
