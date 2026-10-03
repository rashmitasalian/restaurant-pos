/* eslint-disable no-console */
import fs from "fs";
import { decodeInstallationCode } from "../../electron/licensing/installationCode";
import { buildLicenseDocument, LicenseInputError } from "../../electron/licensing/licenseDocument";
import {
  assertReplaceable,
  issuanceWarnings,
  LedgerError,
  nextLicenseId,
  readLedger,
  recordIssuance,
} from "./ledger";
import {
  assertOutsideRepository,
  defaultLedgerPath,
  defaultPrivateKeyPath,
  loadMatchingPrivateKey,
} from "./paths";

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

const customer = option("--customer")?.trim();
const code = option("--code")?.trim();
const outPath = option("--out");
const notes = option("--notes") ?? "";
const replaces = option("--replaces")?.trim();
if (!customer || !code || !outPath) {
  fail(
    'Usage: npm run license:issue -- --customer "Restaurant" --code "RN1-..." --out license.rnlc [--replaces RN-YYYY-NNNNNN] [--notes "..."]',
  );
}

let decoded: ReturnType<typeof decodeInstallationCode>;
try {
  decoded = decodeInstallationCode(code);
} catch {
  fail("Installation code could not be decoded. Paste the full code from the POS.");
}

const privateKeyPem = loadMatchingPrivateKey(defaultPrivateKeyPath());
const ledgerPath = defaultLedgerPath();
assertOutsideRepository(ledgerPath);
const rows = readLedger(ledgerPath);
const machineHash = decoded.machineHash.toString("hex");
const installationPublicKeyHash = decoded.installationPublicKeyHash.toString("hex");

try {
  if (replaces) {
    assertReplaceable(rows, replaces);
  }
} catch (error) {
  fail(error instanceof LedgerError ? error.message : String(error));
}

for (const warning of issuanceWarnings(rows, {
  customer,
  machineHash,
  installationPublicKeyHash,
  replaces,
})) {
  console.warn(`Warning: ${warning}`);
}

const licenseId = option("--license-id") || nextLicenseId(rows);
const issuedAt = new Date().toISOString();
let document: string;
try {
  document = buildLicenseDocument({
    customerName: customer,
    installationCode: code,
    licenseId,
    issuedAt,
    privateKeyPem,
  });
} catch (error) {
  fail(error instanceof LicenseInputError ? error.message : String(error));
}

let saved: ReturnType<typeof recordIssuance>;
try {
  saved = recordIssuance(ledgerPath, {
    licenseId,
    customer,
    installationPublicKeyHash,
    machineHash,
    issuedAt,
    notes,
    replaces,
  });
} catch (error) {
  fail(error instanceof LedgerError ? error.message : String(error));
}
fs.writeFileSync(outPath, document, { mode: 0o600 });
console.log(`Wrote ${outPath}`);
console.log(
  `License ${saved.licenseId} for ${saved.customer} (replacement count ${saved.replacementCount}).`,
);
