import fs from "fs";
import os from "os";
import path from "path";
import { rawPublicKeyFromPem } from "../../electron/licensing/licenseCrypto";
import { vendorPublicKeyRaw, VENDOR_PUBLIC_KEY_BASE64 } from "../../electron/licensing/publicKey";

export function vendorDirectory(): string {
  return path.join(os.homedir(), ".restoniti");
}

export function defaultPrivateKeyPath(): string {
  return process.env.RESTONITI_LICENSE_PRIVATE_KEY?.trim() || path.join(vendorDirectory(), "license-ed25519.pem");
}

export function defaultLedgerPath(): string {
  return process.env.RESTONITI_LICENSE_LEDGER?.trim() || path.join(vendorDirectory(), "license-ledger.jsonl");
}

export function repositoryRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function assertOutsideRepository(targetPath: string) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(repositoryRoot(), resolved);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (inside) {
    throw new Error("The vendor private key and ledger must stay outside the repository.");
  }
}

export function publicKeyMatchesEmbedded(privateKeyPem: string): boolean {
  return rawPublicKeyFromPem(privateKeyPem).equals(vendorPublicKeyRaw());
}

export function loadMatchingPrivateKey(keyPath: string): string {
  assertOutsideRepository(keyPath);
  const pem = fs.readFileSync(keyPath, "utf8");
  if (!publicKeyMatchesEmbedded(pem)) {
    throw new Error(
      "This private key does not match the public key embedded in RestoNiti. Refusing to issue.",
    );
  }
  return pem;
}

export function embeddedPublicKeyBase64(): string {
  return VENDOR_PUBLIC_KEY_BASE64;
}
