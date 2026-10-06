/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { UPDATE_PUBLIC_KEY_BASE64 } from "../../electron/licensing/publicKey";
import { rawPublicKeyFromPem } from "../../electron/licensing/licenseCrypto";
import { signUpdateManifest } from "../../electron/licensing/updateManifest";
import { assertOutsideRepository, vendorDirectory } from "./paths";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const manifestPath = option("--manifest");
if (!manifestPath) {
  fail("Usage: npm run update:sign -- --manifest path/to/manifest.json");
}
const keyPath =
  option("--key") ||
  process.env.RESTONITI_UPDATE_PRIVATE_KEY?.trim() ||
  path.join(vendorDirectory(), "update-ed25519.pem");
assertOutsideRepository(keyPath);
const pem = fs.readFileSync(keyPath, "utf8");
if (rawPublicKeyFromPem(pem).toString("base64") !== UPDATE_PUBLIC_KEY_BASE64) {
  fail("This private key does not match the update public key embedded in RestoNiti. Refusing to sign.");
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  fail("Manifest must be a JSON object.");
}
const signature = signUpdateManifest(manifest, pem);
const signed = { ...manifest, signature };
fs.writeFileSync(manifestPath, `${JSON.stringify(signed, null, 2)}\n`, "utf8");
console.log(`Signed ${manifestPath}`);
