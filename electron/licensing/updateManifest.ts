import crypto from "crypto";
import { publicKeyFromRaw } from "./licenseCrypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Bytes covered by the manifest signature. The signature field itself is not included. */
export function manifestSigningBytes(manifest: Record<string, unknown>): Buffer {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(manifest)) {
    if (key === "signature") {
      continue;
    }
    payload[key] = manifest[key];
  }
  return Buffer.from(canonicalJson(payload), "utf8");
}

export function signUpdateManifest(manifest: Record<string, unknown>, privateKeyPem: string): string {
  return crypto.sign(null, manifestSigningBytes(manifest), crypto.createPrivateKey(privateKeyPem)).toString("base64");
}

export function verifyUpdateManifestSignature(
  manifest: Record<string, unknown>,
  signatureBase64: string,
  publicKey: Buffer,
): boolean {
  try {
    const signature = Buffer.from(String(signatureBase64 || ""), "base64");
    if (signature.length !== 64) {
      return false;
    }
    return crypto.verify(null, manifestSigningBytes(manifest), publicKeyFromRaw(publicKey), signature);
  } catch {
    return false;
  }
}
