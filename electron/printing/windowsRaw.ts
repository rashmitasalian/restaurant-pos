import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { isSelectablePosPrinter, type InstalledPrinterInfo } from "../../src/shared/printerConfig";
import { printViaWindowsRawWorker } from "./windowsRawWorker";

type ExecResult = {
  stdout: string;
  stderr: string;
};

const POWERSHELL = "powershell.exe";

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || error).trim();
          reject(new Error(detail || error.message));
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
  });
}

function toPrinterInfo(entry: unknown): InstalledPrinterInfo | null {
  if (typeof entry === "string" || typeof entry === "number") {
    const name = String(entry).trim();
    return name ? { name } : null;
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rec = entry as Record<string, unknown>;
  const name = String(rec.Name || rec.name || "").trim();
  if (!name) {
    return null;
  }
  const driverName = String(rec.DriverName || rec.driverName || "").trim();
  const portName = String(rec.PortName || rec.portName || "").trim();
  return {
    name,
    driverName: driverName || undefined,
    portName: portName || undefined,
  };
}

export function parseWindowsPrinterListOutput(stdout: string): InstalledPrinterInfo[] {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map(toPrinterInfo)
    .filter((printer): printer is InstalledPrinterInfo => Boolean(printer));
}

export async function listWindowsPrinters(): Promise<InstalledPrinterInfo[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const command =
    "$ErrorActionPreference = 'Stop'; " +
    "Get-Printer | Select-Object Name, DriverName, PortName | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    10000,
  );
  return parseWindowsPrinterListOutput(stdout).filter(isSelectablePosPrinter);
}

function resolveUserDataDir() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    return app.getPath("userData");
  } catch {
    return path.join(os.tmpdir(), "restoniti-print");
  }
}

export async function printViaWindowsRaw(printerName: string, escPosBuffer: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("windows-raw-printing-only-supported-on-windows");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-print-"));
  const dataPath = path.join(tempDir, "job.bin");

  try {
    fs.writeFileSync(dataPath, escPosBuffer);
    console.log(`[WIN-RAW] Sending ${escPosBuffer.length} raw bytes via Winspool WritePrinter.`);
    await printViaWindowsRawWorker(resolveUserDataDir(), printerName, dataPath);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}
