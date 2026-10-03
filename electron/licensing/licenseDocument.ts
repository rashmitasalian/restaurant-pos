import crypto from "crypto";
import { decodeInstallationCode } from "./installationCode";
import { rawPublicKeyFromPem, signLicensePayload } from "./licenseCrypto";
import { LICENSE_PLAN, LICENSE_PRODUCT } from "./licenseTypes";
import type { LicensePayloadFields } from "./licenseTypes";
import { LICENSE_ID_PATTERN, MAX_CUSTOMER_NAME_LENGTH, verifySignedLicense } from "./licenseValidator";

export class LicenseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseInputError";
  }
}

export function buildLicenseDocument(input: {
  customerName: string;
  installationCode: string;
  licenseId: string;
  issuedAt: string;
  privateKeyPem: string;
}): string {
  if (!LICENSE_ID_PATTERN.test(input.licenseId)) {
    throw new LicenseInputError("License id must look like RN-2026-000123.");
  }
  if (input.customerName.length === 0 || input.customerName.trim() !== input.customerName) {
    throw new LicenseInputError("Restaurant name must not be empty or start or end with spaces.");
  }
  if (input.customerName.length > MAX_CUSTOMER_NAME_LENGTH) {
    throw new LicenseInputError(
      `Restaurant name must be ${MAX_CUSTOMER_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (Number.isNaN(Date.parse(input.issuedAt)) || input.issuedAt.length > 64) {
    throw new LicenseInputError("Issued date must be an ISO timestamp.");
  }
  const decoded = decodeInstallationCode(input.installationCode);
  const payload: LicensePayloadFields = {
    licenseId: input.licenseId,
    product: LICENSE_PRODUCT,
    customerName: input.customerName,
    plan: LICENSE_PLAN,
    perpetual: true,
    issuedAt: input.issuedAt,
    installationPublicKeyHash: decoded.installationPublicKeyHash.toString("hex"),
    machineHash: decoded.machineHash.toString("hex"),
  };
  const signature = signLicensePayload(payload, input.privateKeyPem);
  const document = { payload: { licenseVersion: 1, ...payload }, signature };
  const check = verifySignedLicense(document, rawPublicKeyFromPem(input.privateKeyPem));
  if (!check.valid) {
    throw new LicenseInputError(`Issued license failed its own check (${check.reason}).`);
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function generateTestVendorKeyPair(): { publicKey: Buffer; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("test-vendor-key");
  }
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  if (typeof pem !== "string") {
    throw new Error("test-vendor-key");
  }
  return { publicKey: Buffer.from(jwk.x, "base64url"), privateKeyPem: pem };
}
