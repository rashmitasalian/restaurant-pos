/* eslint-disable no-console */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { UPDATE_PUBLIC_KEY_BASE64 } from "../../electron/licensing/publicKey";
import { rawPublicKeyFromPem } from "../../electron/licensing/licenseCrypto";
import { assertOutsideRepository, vendorDirectory } from "./paths";

function updatePrivateKeyPath() {
  return (
    process.env.RESTONITI_UPDATE_PRIVATE_KEY?.trim() ||
    path.join(vendorDirectory(), "update-ed25519.pem")
  );
}

const keyPath = updatePrivateKeyPath();
assertOutsideRepository(keyPath);
fs.mkdirSync(vendorDirectory(), { recursive: true });

if (fs.existsSync(keyPath)) {
  const pem = fs.readFileSync(keyPath, "utf8");
  const matches = rawPublicKeyFromPem(pem).toString("base64") === UPDATE_PUBLIC_KEY_BASE64;
  console.log(`Update private key already exists:\n${keyPath}`);
  console.log(
    matches
      ? "It matches the update public key embedded in the app."
      : "It does NOT match electron/licensing/publicKey.ts UPDATE_PUBLIC_KEY_BASE64. Do not sign manifests until those keys are the same pair.",
  );
  process.exit(0);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
if (typeof pem !== "string") {
  throw new Error("Could not export the update private key.");
}
fs.writeFileSync(keyPath, pem, { mode: 0o600 });
const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
if (!jwk.x) {
  throw new Error("Could not export the update public key.");
}
const publicKeyBase64 = Buffer.from(jwk.x, "base64url").toString("base64");
console.log(`Wrote update private key:\n${keyPath}`);
console.log(`Public key (embed as UPDATE_PUBLIC_KEY_BASE64):\n${publicKeyBase64}`);
if (publicKeyBase64 !== UPDATE_PUBLIC_KEY_BASE64) {
  console.log("This new public key is not the one embedded in the app. Update publicKey.ts before signing manifests.");
}
