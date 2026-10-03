/* eslint-disable no-console */
import crypto from "crypto";
import fs from "fs";
import {
  assertOutsideRepository,
  defaultPrivateKeyPath,
  embeddedPublicKeyBase64,
  publicKeyMatchesEmbedded,
  vendorDirectory,
} from "./paths";

const keyPath = defaultPrivateKeyPath();
assertOutsideRepository(keyPath);
fs.mkdirSync(vendorDirectory(), { recursive: true });

if (fs.existsSync(keyPath)) {
  const pem = fs.readFileSync(keyPath, "utf8");
  console.log(`Vendor private key already exists:\n${keyPath}`);
  console.log(
    publicKeyMatchesEmbedded(pem)
      ? "It matches the public key embedded in the app."
      : "It does NOT match electron/licensing/publicKey.ts. Do not issue licenses until those keys are the same pair.",
  );
  process.exit(0);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
if (typeof pem !== "string") {
  throw new Error("Could not export the vendor private key.");
}
fs.writeFileSync(keyPath, pem, { mode: 0o600 });
const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
if (!jwk.x) {
  throw new Error("Could not export the vendor public key.");
}
const publicKeyBase64 = Buffer.from(jwk.x, "base64url").toString("base64");
console.log(`Wrote vendor private key:\n${keyPath}`);
console.log(`Public key (embed in electron/licensing/publicKey.ts):\n${publicKeyBase64}`);
if (publicKeyBase64 !== embeddedPublicKeyBase64()) {
  console.log("This new public key is not the one embedded in the app. Update publicKey.ts before issuing licenses.");
}
