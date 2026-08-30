import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
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

export async function listWindowsPrinters(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const command =
    "$ErrorActionPreference = 'Stop'; " +
    "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    10000,
  );
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((name) => String(name));
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
