/* eslint-disable no-console */
import fs from "fs";
import { customerLicenseMessage } from "../../electron/licensing/licenseErrors";
import { verifySignedLicense } from "../../electron/licensing/licenseValidator";
import { vendorPublicKeyRaw } from "../../electron/licensing/publicKey";

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

const filePath = option("--file");
if (!filePath) {
  console.error("Usage: npm run license:verify -- --file license.rnlc");
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch {
  console.error("License file could not be read.");
  process.exit(1);
}

const check = verifySignedLicense(parsed, vendorPublicKeyRaw());
if (!check.valid) {
  console.error(`Rejected (${check.reason}): ${customerLicenseMessage(check.reason)}`);
  process.exit(1);
}

const fields = check.payload;
console.log("Accepted by the same checks the POS runs, except the PC binding.");
console.log(`License ${fields.licenseId}`);
console.log(`Restaurant ${fields.customerName}`);
console.log(`Plan ${fields.plan}`);
console.log(`Issued ${fields.issuedAt}`);
console.log(`Machine hash ${fields.machineHash}`);
console.log(`Installation hash ${fields.installationPublicKeyHash}`);
