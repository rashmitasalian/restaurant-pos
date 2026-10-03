export const LICENSE_PRODUCT = "restoniti-offline";
export const LICENSE_PLAN = "offline-perpetual";
export const LICENSE_VERSION = 1;
export const IDENTITY_VERSION = 1;

export type LicenseInvalidReason =
  | "license-malformed"
  | "signature-invalid"
  | "wrong-product"
  | "unsupported-license-version"
  | "machine-mismatch"
  | "installation-mismatch"
  | "not-perpetual"
  | "identity-unreadable";

export type LicensePayloadFields = {
  licenseId: string;
  product: string;
  customerName: string;
  plan: string;
  perpetual: boolean;
  issuedAt: string;
  installationPublicKeyHash: string;
  machineHash: string;
};

export type LicenseValidationResult =
  | { valid: true; licenseId: string; customerName: string }
  | { valid: false; reason: LicenseInvalidReason };

export type IdentityFile = {
  version: 1;
  publicKey: string;
  privateKeyProtected: string;
};

export type KeyProtector = {
  isAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export type LicenseStatus =
  | {
      status: "licensed";
      devBypass?: boolean;
      licenseId?: string;
      customerName?: string;
      plan?: "offline-perpetual";
    }
  | {
      status: "unlicensed";
      message: string;
      supportDetail: string | null;
    };
