import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";

const POWERSHELL = "powershell.exe";
const JOB_TIMEOUT_MS = 20_000;

export function assertRawPrintJob(printerName: string, dataPath: string) {
  if (!printerName.trim() || /[|\r\n\0]/.test(printerName) || /[|\r\n\0]/.test(dataPath)) {
    throw new Error("windows-raw-print-invalid-job");
  }
}

function buildWorkerScript() {
  return String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOC_INFO_1
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDatatype;
    }

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, [In] DOC_INFO_1 pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(
        IntPtr hPrinter,
        [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] pBytes,
        int dwCount,
        out int dwWritten
    );

    private static void ThrowLastWin32(string action)
    {
        int error = Marshal.GetLastWin32Error();
        throw new Win32Exception(error, action + " failed (" + error + ")");
    }

    public static void SendFile(string printerName, string filePath, string documentName)
    {
        byte[] bytes = File.ReadAllBytes(filePath);
        if (bytes.Length == 0)
        {
            throw new InvalidOperationException("No bytes to print");
        }

        IntPtr printerHandle;
        if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero))
        {
            ThrowLastWin32("OpenPrinter");
        }

        try
        {
            DOC_INFO_1 docInfo = new DOC_INFO_1();
            docInfo.pDocName = documentName;
            docInfo.pOutputFile = null;
            docInfo.pDatatype = "RAW";

            if (!StartDocPrinter(printerHandle, 1, docInfo))
            {
                ThrowLastWin32("StartDocPrinter");
            }

            try
            {
                if (!StartPagePrinter(printerHandle))
                {
                    ThrowLastWin32("StartPagePrinter");
                }

                try
                {
                    int written;
                    if (!WritePrinter(printerHandle, bytes, bytes.Length, out written))
                    {
                        ThrowLastWin32("WritePrinter");
                    }
                    if (written != bytes.Length)
                    {
                        throw new IOException("WritePrinter wrote " + written + " of " + bytes.Length + " bytes");
                    }
                }
                finally
                {
                    EndPagePrinter(printerHandle);
                }
            }
            finally
            {
                EndDocPrinter(printerHandle);
            }
        }
        finally
        {
            ClosePrinter(printerHandle);
        }
    }
}
"@

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq "EXIT") { break }
    $parts = $line -split '\|', 2
    if ($parts.Length -lt 2) {
        [Console]::Out.WriteLine("ERR:invalid-job")
        [Console]::Out.Flush()
        continue
    }
    try {
        [RawPrinterHelper]::SendFile($parts[0], $parts[1], "RestoNiti Raw ESC/POS")
        [Console]::Out.WriteLine("OK")
        [Console]::Out.Flush()
    } catch {
        $message = $_.Exception.Message -replace '[\r\n]+', ' '
        [Console]::Out.WriteLine("ERR:$message")
        [Console]::Out.Flush()
    }
}
`;
}

class WindowsRawPrintWorker {
  private process: ChildProcessWithoutNullStreams | null = null;
  private scriptPath: string | null = null;
  private stdoutBuffer = "";
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private pendingResponse: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private jobChain: Promise<void> = Promise.resolve();

  constructor(private readonly userDataDir: string) {}

  private getWorkerScriptPath() {
    if (!this.scriptPath) {
      const dir = path.join(this.userDataDir, "print");
      fs.mkdirSync(dir, { recursive: true });
      this.scriptPath = path.join(dir, "raw-print-worker.ps1");
      fs.writeFileSync(this.scriptPath, buildWorkerScript(), "utf-8");
    }
    return this.scriptPath;
  }

  private resetReadyWaiter() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  private failPending(error: Error) {
    if (this.pendingResponse) {
      clearTimeout(this.pendingResponse.timer);
      this.pendingResponse.reject(error);
      this.pendingResponse = null;
    }
    if (this.readyReject) {
      this.readyReject(error);
      this.readyResolve = null;
      this.readyReject = null;
      this.readyPromise = null;
    }
  }

  private handleStdout(chunk: Buffer | string) {
    this.stdoutBuffer += String(chunk);
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.handleWorkerLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleWorkerLine(line: string) {
    if (line === "READY") {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    const pending = this.pendingResponse;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingResponse = null;

    if (line === "OK") {
      pending.resolve();
      return;
    }
    if (line.startsWith("ERR:")) {
      pending.reject(new Error(line.slice(4).trim() || "windows-raw-print-failed"));
      return;
    }
    pending.reject(new Error(line || "windows-raw-print-failed"));
  }

  private async ensureStarted() {
    if (this.process && !this.process.killed) {
      if (this.readyPromise) {
        await this.readyPromise;
      }
      return;
    }

    this.resetReadyWaiter();
    const scriptPath = this.getWorkerScriptPath();
    const child = spawn(
      POWERSHELL,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Sta", "-File", scriptPath],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.process = child;

    child.stdout.on("data", (data) => this.handleStdout(data));
    child.stderr.on("data", (data) => {
      const message = String(data || "").trim();
      if (message) {
        console.warn(`[WIN-RAW] worker stderr: ${message}`);
      }
    });
    child.on("error", (error) => {
      this.failPending(error);
      this.process = null;
    });
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        this.failPending(new Error(`windows-raw-worker-exited:${code}`));
      } else if (signal) {
        this.failPending(new Error(`windows-raw-worker-signal:${signal}`));
      } else {
        this.failPending(new Error("windows-raw-worker-stopped"));
      }
      this.process = null;
    });

    const ready = this.readyPromise;
    if (!ready) {
      throw new Error("windows-raw-worker-start-failed");
    }
    await Promise.race([
      ready,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("windows-raw-worker-ready-timeout")), JOB_TIMEOUT_MS);
      }),
    ]);
  }

  private async runJob(printerName: string, dataPath: string) {
    assertRawPrintJob(printerName, dataPath);
    await this.ensureStarted();
    const process = this.process;
    if (!process?.stdin) {
      throw new Error("windows-raw-worker-unavailable");
    }
    if (this.pendingResponse) {
      throw new Error("windows-raw-worker-busy");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponse = null;
        this.stop();
        reject(new Error("windows-raw-print-timeout"));
      }, JOB_TIMEOUT_MS);

      this.pendingResponse = { resolve, reject, timer };
      const command = `${printerName}|${dataPath}\n`;
      process.stdin.write(command, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pendingResponse = null;
          reject(error);
        }
      });
    });
  }

  print(printerName: string, dataPath: string): Promise<void> {
    const next = this.jobChain.then(() => this.runJob(printerName, dataPath));
    this.jobChain = next.catch(() => undefined);
    return next;
  }

  warmUp() {
    void this.ensureStarted().catch((error) => {
      console.warn("[WIN-RAW] worker warm-up failed:", error?.message || error);
    });
  }

  stop() {
    try {
      if (this.process?.stdin && !this.process.killed) {
        this.process.stdin.write("EXIT\n");
      }
    } catch {
      // ignore
    }
    try {
      this.process?.kill();
    } catch {
      // ignore
    }
    this.process = null;
    this.failPending(new Error("windows-raw-worker-stopped"));
  }
}

let worker: WindowsRawPrintWorker | null = null;

function getWorker(userDataDir: string) {
  if (!worker) {
    worker = new WindowsRawPrintWorker(userDataDir);
  }
  return worker;
}

export function warmUpWindowsRawPrinter(userDataDir: string) {
  if (process.platform !== "win32") {
    return;
  }
  getWorker(userDataDir).warmUp();
}

export function shutdownWindowsRawPrinter() {
  worker?.stop();
  worker = null;
}

export async function printViaWindowsRawWorker(
  userDataDir: string,
  printerName: string,
  dataPath: string,
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("windows-raw-printing-only-supported-on-windows");
  }
  await getWorker(userDataDir).print(printerName, dataPath);
}
