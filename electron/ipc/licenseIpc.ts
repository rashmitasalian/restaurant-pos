import fs from "fs";
import path from "path";
import { BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { customerLicenseMessage } from "../licensing/licenseErrors";
import {
  importRuntimeLicense,
  installationCodeForRenderer,
  licenseStatusForRenderer,
} from "../licensing/licenseService";

const MAX_LICENSE_BYTES = 65_536;

function readLicenseImport(filePath: string): { ok: true; text: string } | { ok: false; message: string } {
  const resolved = path.resolve(String(filePath || ""));
  if (path.extname(resolved).toLowerCase() !== ".rnlc") {
    return { ok: false, message: customerLicenseMessage("license-malformed") };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, message: customerLicenseMessage("license-malformed") };
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LICENSE_BYTES) {
    return { ok: false, message: customerLicenseMessage("license-malformed") };
  }
  return { ok: true, text: fs.readFileSync(resolved, "utf8") };
}

export function registerLicenseIpc(
  onLicensed: () => Promise<void>,
  onStartupError: (error: unknown) => void,
) {
  ipcMain.handle("license:get-status", () => licenseStatusForRenderer());

  ipcMain.handle("license:get-installation-code", () => installationCodeForRenderer());

  ipcMain.handle("license:copy-installation-code", () => {
    const code = installationCodeForRenderer();
    if (!code.ok) {
      return code;
    }
    clipboard.writeText(code.code);
    return { ok: true };
  });

  ipcMain.handle("license:import", async (event, filePath?: string) => {
    let target = typeof filePath === "string" ? filePath : "";
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: "Import RestoNiti license",
        filters: [{ name: "RestoNiti license", extensions: ["rnlc"] }],
        properties: ["openFile"] as Array<"openFile">,
      };
      const picked = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, cancelled: true };
      }
      target = picked.filePaths[0];
    }
    const file = readLicenseImport(target);
    if (!file.ok) {
      return file;
    }
    const imported = importRuntimeLicense(file.text);
    if (!imported.ok) {
      return { ok: false, message: imported.message, reason: imported.reason };
    }
    if (imported.evaluation.openDatabase) {
      try {
        await onLicensed();
      } catch (error) {
        onStartupError(error);
        return {
          ok: false,
          reason: "startup-failed",
          message:
            "This license is valid, but RestoNiti could not start. Restart the app. If it happens again, contact RestoNiti support.",
        };
      }
    }
    return {
      ok: true,
      licenseId: imported.evaluation.licenseId,
      customerName: imported.evaluation.customerName,
    };
  });
}
