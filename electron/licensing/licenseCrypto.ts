import crypto from "crypto";
import { canonicalLicensePayload } from "./licenseCanonical";
import type { LicensePayloadFields } from "./licenseTypes";

export const INSTALLATION_PROOF_PREFIX = "restoniti-installation-v1\n";

export function publicKeyFromRaw(raw: Buffer): crypto.KeyObject {
  if (raw.length !== 32) {
    throw new Error("public-key-length");
  }
  return crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

export function rawPublicKeyFromPem(privateKeyPem: string): Buffer {
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem));
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("public-key-export");
  }
  const raw = Buffer.from(jwk.x, "base64url");
  if (raw.length !== 32) {
    throw new Error("public-key-length");
  }
  return raw;
}

export function installationPublicKeyHash(rawPublicKey: Buffer): Buffer {
  return crypto.createHash("sha256").update(rawPublicKey).digest();
}

export function signLicensePayload(payload: LicensePayloadFields, privateKeyPem: string): string {
  const bytes = Buffer.from(canonicalLicensePayload(payload), "utf8");
  return crypto.sign(null, bytes, crypto.createPrivateKey(privateKeyPem)).toString("base64");
}

export function verifyLicenseSignature(
  payload: LicensePayloadFields,
  signatureBase64: string,
  vendorPublicKey: Buffer,
): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) {
      return false;
    }
    const bytes = Buffer.from(canonicalLicensePayload(payload), "utf8");
    return crypto.verify(null, bytes, publicKeyFromRaw(vendorPublicKey), signature);
  } catch {
    return false;
  }
}

export function proveInstallationKey(rawPublicKey: Buffer, privateKeyPem: string): boolean {
  const hashHex = installationPublicKeyHash(rawPublicKey).toString("hex");
  const message = Buffer.from(`${INSTALLATION_PROOF_PREFIX}${hashHex}`, "utf8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, message, privateKey);
  return crypto.verify(null, message, publicKeyFromRaw(rawPublicKey), signature);
}
