import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { IdentityFile, KeyProtector } from "./licenseTypes";
import { IDENTITY_VERSION } from "./licenseTypes";

const MAX_IDENTITY_BYTES = 65_536;

export function identityFilePath(userDataDir: string): string {
  return path.join(userDataDir, "license", "installation.identity.json");
}

export function serializeIdentity(file: IdentityFile): string {
  return `${JSON.stringify(
    {
      version: file.version,
      publicKey: file.publicKey,
      privateKeyProtected: file.privateKeyProtected,
    },
    null,
    2,
  )}\n`;
}

function decodeRawPublicKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  const raw = Buffer.from(value, "base64");
  if (raw.length !== 32) {
    return null;
  }
  return raw;
}

export function parseIdentityFile(text: string): { file: IdentityFile; rawPublicKey: Buffer } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== IDENTITY_VERSION) {
    return null;
  }
  if (typeof record.publicKey !== "string" || typeof record.privateKeyProtected !== "string") {
    return null;
  }
  const rawPublicKey = decodeRawPublicKey(record.publicKey);
  if (!rawPublicKey || record.privateKeyProtected.length === 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(record.privateKeyProtected)) {
    return null;
  }
  return {
    rawPublicKey,
    file: {
      version: 1,
      publicKey: record.publicKey,
      privateKeyProtected: record.privateKeyProtected,
    },
  };
}

function readIdentityFromDisk(filePath: string): { file: IdentityFile; rawPublicKey: Buffer } | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IDENTITY_BYTES) {
    return null;
  }
  return parseIdentityFile(fs.readFileSync(filePath, "utf8"));
}

export function createInstallationIdentity(
  protector: KeyProtector,
): { file: IdentityFile; rawPublicKey: Buffer } | { error: "protection-unavailable" } {
  if (!protector.isAvailable()) {
    return { error: "protection-unavailable" };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("installation-public-key");
  }
  const rawPublicKey = Buffer.from(jwk.x, "base64url");
  if (rawPublicKey.length !== 32) {
    throw new Error("installation-public-key");
  }
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  if (typeof pem !== "string") {
    throw new Error("installation-private-key");
  }
  const encrypted = protector.encryptString(pem);
  return {
    rawPublicKey,
    file: {
      version: 1,
      publicKey: rawPublicKey.toString("base64"),
      privateKeyProtected: encrypted.toString("base64"),
    },
  };
}

/** Returns false when another process already created the identity file. */
function writeNewIdentityFile(filePath: string, file: IdentityFile): boolean {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, serializeIdentity(file), { mode: 0o600 });
  try {
    // linkSync never replaces an existing file, so a concurrent first launch cannot swap keys.
    fs.linkSync(tempPath, filePath);
    return true;
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export type IdentityLoadResult =
  | { ok: true; created: boolean; file: IdentityFile; rawPublicKey: Buffer }
  | { ok: false; reason: "identity-unreadable" | "protection-unavailable" };

/** Creates an identity only when the file is missing. Never replaces a present file. */
export function loadOrCreateInstallationIdentity(
  userDataDir: string,
  protector: KeyProtector,
): IdentityLoadResult {
  const filePath = identityFilePath(userDataDir);
  if (!fs.existsSync(filePath)) {
    const created = createInstallationIdentity(protector);
    if ("error" in created) {
      return { ok: false, reason: "protection-unavailable" };
    }
    if (writeNewIdentityFile(filePath, created.file)) {
      return { ok: true, created: true, file: created.file, rawPublicKey: created.rawPublicKey };
    }
  }
  const existing = readIdentityFromDisk(filePath);
  if (!existing) {
    return { ok: false, reason: "identity-unreadable" };
  }
  return { ok: true, created: false, file: existing.file, rawPublicKey: existing.rawPublicKey };
}
