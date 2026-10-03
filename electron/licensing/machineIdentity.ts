import { execFileSync } from "child_process";
import crypto from "crypto";
import path from "path";

const MACHINE_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizeMachineGuid(raw: string): string {
  const guid = String(raw ?? "").trim().toLowerCase();
  if (!MACHINE_GUID_PATTERN.test(guid)) {
    throw new Error("machine-guid-malformed");
  }
  return guid;
}

export function machineHashFromGuid(normalizedGuid: string): Buffer {
  return crypto.createHash("sha256").update(Buffer.from(normalizedGuid, "utf8")).digest();
}

export function readWindowsMachineGuid(): string {
  if (process.platform !== "win32") {
    throw new Error("machine-guid-unavailable");
  }
  let output = "";
  try {
    // Absolute path so a reg.exe placed in the working directory or PATH is never used.
    const regExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
    output = execFileSync(
      regExe,
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"],
      { encoding: "utf8", windowsHide: true },
    );
  } catch {
    throw new Error("machine-guid-unavailable");
  }
  return machineGuidFromRegOutput(output);
}

export function machineGuidFromRegOutput(output: string): string {
  const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
  if (!match) {
    throw new Error("machine-guid-unavailable");
  }
  return normalizeMachineGuid(match[1]);
}
