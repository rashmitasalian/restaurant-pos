import fs from "fs";
import path from "path";
import { getDatabasePath } from "../db/sqlite";

export const LIVE_SIDECAR_NAME = "operations-live.json";
export const RESTORE_INTENT_NAME = "operations-restore.json";

export type OperationsMarker = {
  liveStartedAt: number;
  liveStartedBy: string;
  liveStartOperationId: string;
  backupId: string;
};

export type RestoreIntentPhase = "safety-ready" | "database-replaced";

export type RestoreIntent = {
  kind: "pre-live-restore";
  phase: RestoreIntentPhase;
  acknowledgedBy: string;
  acknowledgedAt: number;
  safetyCopyPath: string;
  sourceLabel: string;
};

function dataDirectory() {
  return path.dirname(getDatabasePath());
}

export function sidecarPath() {
  return path.join(dataDirectory(), LIVE_SIDECAR_NAME);
}

export function restoreIntentPath() {
  return path.join(dataDirectory(), RESTORE_INTENT_NAME);
}

function replaceFile(temporaryPath: string, destination: string) {
  if (fs.existsSync(destination)) {
    const previous = `${destination}.previous`;
    fs.rmSync(previous, { force: true });
    fs.renameSync(destination, previous);
    try {
      fs.renameSync(temporaryPath, destination);
      fs.rmSync(previous, { force: true });
    } catch (error) {
      if (!fs.existsSync(destination) && fs.existsSync(previous)) {
        fs.renameSync(previous, destination);
      }
      throw error;
    }
    return;
  }
  fs.renameSync(temporaryPath, destination);
}

export function writeAtomicJson(destination: string, value: unknown) {
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  const fd = fs.openSync(temporaryPath, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    replaceFile(temporaryPath, destination);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  return parsed;
}

export function readSidecarFile(): OperationsMarker | null {
  const parsed = readJsonFile<OperationsMarker>(sidecarPath());
  if (!parsed?.liveStartedAt || !parsed.liveStartOperationId) {
    return null;
  }
  return parsed;
}

export function writeSidecarFile(marker: OperationsMarker) {
  writeAtomicJson(sidecarPath(), marker);
}

export function removeSidecarFile() {
  const destination = sidecarPath();
  if (!fs.existsSync(destination)) {
    return;
  }
  const holding = `${destination}.removing`;
  fs.rmSync(holding, { force: true });
  fs.renameSync(destination, holding);
  fs.rmSync(holding, { force: true });
}

export function readIntentFile(): RestoreIntent | null {
  const parsed = readJsonFile<RestoreIntent>(restoreIntentPath());
  if (!parsed || parsed.kind !== "pre-live-restore" || !parsed.safetyCopyPath) {
    return null;
  }
  if (parsed.phase !== "safety-ready" && parsed.phase !== "database-replaced") {
    return null;
  }
  return parsed;
}

export function writeIntentFile(intent: RestoreIntent) {
  writeAtomicJson(restoreIntentPath(), intent);
}

export function removeIntentFile() {
  fs.rmSync(restoreIntentPath(), { force: true });
}
