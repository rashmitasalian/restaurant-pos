import { proveInstallationKey, verifyLicenseSignature } from "./licenseCrypto";
import { installationPublicKeyHash } from "./licenseCrypto";
import { LICENSE_PLAN, LICENSE_PRODUCT, LICENSE_VERSION } from "./licenseTypes";
import type {
  IdentityFile,
  KeyProtector,
  LicenseInvalidReason,
  LicensePayloadFields,
  LicenseValidationResult,
} from "./licenseTypes";

export const LICENSE_ID_PATTERN = /^RN-\d{4}-\d{6}$/;
export const MAX_CUSTOMER_NAME_LENGTH = 200;
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/;

type ParsedLicense = {
  payload: LicensePayloadFields & { licenseVersion: number };
  signature: string;
};

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return value;
}

function parseLicense(license: unknown): ParsedLicense | null {
  if (!license || typeof license !== "object") {
    return null;
  }
  const root = license as Record<string, unknown>;
  const payload = root.payload;
  if (!payload || typeof payload !== "object" || typeof root.signature !== "string") {
    return null;
  }
  const fields = payload as Record<string, unknown>;
  if (typeof fields.licenseVersion !== "number" || !Number.isInteger(fields.licenseVersion)) {
    return null;
  }
  const licenseId = readString(fields.licenseId, 32);
  const product = readString(fields.product, 64);
  const customerName = readString(fields.customerName, MAX_CUSTOMER_NAME_LENGTH);
  const plan = readString(fields.plan, 64);
  const issuedAt = readString(fields.issuedAt, 64);
  const installationPublicKeyHash = readString(fields.installationPublicKeyHash, 64);
  const machineHash = readString(fields.machineHash, 64);
  if (
    !licenseId ||
    !LICENSE_ID_PATTERN.test(licenseId) ||
    !product ||
    !customerName ||
    !plan ||
    typeof fields.perpetual !== "boolean" ||
    !issuedAt ||
    !installationPublicKeyHash ||
    !HEX_HASH_PATTERN.test(installationPublicKeyHash) ||
    !machineHash ||
    !HEX_HASH_PATTERN.test(machineHash)
  ) {
    return null;
  }
  return {
    signature: root.signature,
    payload: {
      licenseVersion: fields.licenseVersion,
      licenseId,
      product,
      customerName,
      plan,
      perpetual: fields.perpetual,
      issuedAt,
      installationPublicKeyHash,
      machineHash,
    },
  };
}

function decodeIdentityPublicKey(identity: IdentityFile): Buffer | null {
  if (identity.version !== 1 || typeof identity.publicKey !== "string") {
    return null;
  }
  const raw = Buffer.from(identity.publicKey, "base64");
  if (raw.length !== 32) {
    return null;
  }
  return raw;
}

export type SignedLicenseCheck =
  | { valid: true; payload: LicensePayloadFields }
  | { valid: false; reason: LicenseInvalidReason };

/** Shape, version, product, vendor signature, perpetual, and plan. No machine or installation binding. */
export function verifySignedLicense(license: unknown, vendorPublicKey: Buffer): SignedLicenseCheck {
  const parsed = parseLicense(license);
  if (!parsed) {
    return { valid: false, reason: "license-malformed" };
  }
  if (parsed.payload.licenseVersion !== LICENSE_VERSION) {
    return { valid: false, reason: "unsupported-license-version" };
  }
  if (parsed.payload.product !== LICENSE_PRODUCT) {
    return { valid: false, reason: "wrong-product" };
  }
  const signedFields: LicensePayloadFields = {
    licenseId: parsed.payload.licenseId,
    product: parsed.payload.product,
    customerName: parsed.payload.customerName,
    plan: parsed.payload.plan,
    perpetual: parsed.payload.perpetual,
    issuedAt: parsed.payload.issuedAt,
    installationPublicKeyHash: parsed.payload.installationPublicKeyHash,
    machineHash: parsed.payload.machineHash,
  };
  if (!verifyLicenseSignature(signedFields, parsed.signature, vendorPublicKey)) {
    return { valid: false, reason: "signature-invalid" };
  }
  if (parsed.payload.perpetual !== true) {
    return { valid: false, reason: "not-perpetual" };
  }
  if (parsed.payload.plan !== LICENSE_PLAN) {
    return { valid: false, reason: "license-malformed" };
  }
  return { valid: true, payload: signedFields };
}

export function validateLicense(input: {
  license: unknown;
  identity: IdentityFile;
  machineHashHex: string;
  vendorPublicKey: Buffer;
  protector: KeyProtector;
}): LicenseValidationResult {
  const signed = verifySignedLicense(input.license, input.vendorPublicKey);
  if (!signed.valid) {
    return signed;
  }
  const payload = signed.payload;

  let privateKeyPem = "";
  try {
    const protectedBytes = Buffer.from(input.identity.privateKeyProtected, "base64");
    privateKeyPem = input.protector.decryptString(protectedBytes);
    const rawPublicKey = decodeIdentityPublicKey(input.identity);
    if (!rawPublicKey || !proveInstallationKey(rawPublicKey, privateKeyPem)) {
      return { valid: false, reason: "identity-unreadable" };
    }
    const publicKeyHash = installationPublicKeyHash(rawPublicKey).toString("hex");
    if (publicKeyHash !== payload.installationPublicKeyHash) {
      return { valid: false, reason: "installation-mismatch" };
    }
  } catch {
    return { valid: false, reason: "identity-unreadable" };
  } finally {
    privateKeyPem = "";
  }

  if (input.machineHashHex !== payload.machineHash) {
    return { valid: false, reason: "machine-mismatch" };
  }
  return {
    valid: true,
    licenseId: payload.licenseId,
    customerName: payload.customerName,
  };
}
