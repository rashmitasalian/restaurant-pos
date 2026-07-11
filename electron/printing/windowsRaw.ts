import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

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

function winspoolRawScript() {
  return String.raw`
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath,
  [string]$DocumentName = "RestoNiti Raw ESC/POS"
)

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

[RawPrinterHelper]::SendFile($PrinterName, $DataPath, $DocumentName)
Write-Output "OK"
`;
}

export async function printViaWindowsRaw(printerName: string, escPosBuffer: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("windows-raw-printing-only-supported-on-windows");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-print-"));
  const dataPath = path.join(tempDir, "job.bin");
  const scriptPath = path.join(tempDir, "write-raw.ps1");

  try {
    try {
      const names = await listWindowsPrinters();
      const match = names.find((name) => name.toLowerCase() === printerName.toLowerCase());
      if (!match) {
        console.warn(
          `[WIN-RAW] Printer "${printerName}" was not found in Get-Printer output. ` +
            `Available printers: ${names.join(", ") || "(none)"}. Trying OpenPrinter anyway.`,
        );
      } else {
        console.log(`[WIN-RAW] Printer "${match}" confirmed in Windows printer list.`);
      }
    } catch (error: any) {
      console.warn(`[WIN-RAW] Could not list installed printers: ${error?.message || error}`);
    }

    fs.writeFileSync(dataPath, escPosBuffer);
    fs.writeFileSync(scriptPath, winspoolRawScript(), "utf-8");

    console.log(`[WIN-RAW] Sending ${escPosBuffer.length} raw bytes via Winspool WritePrinter.`);
    const { stdout } = await execFileAsync(
      POWERSHELL,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-PrinterName",
        printerName,
        "-DataPath",
        dataPath,
      ],
      20000,
    );

    if (!stdout.includes("OK")) {
      console.warn(`[WIN-RAW] Winspool helper completed with unexpected output: ${stdout.trim()}`);
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}
