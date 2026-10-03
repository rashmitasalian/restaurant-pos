import { encodeInstallationCode } from "./installationCode";
import { customerLicenseMessage } from "./licenseErrors";
import { installationPublicKeyHash } from "./licenseCrypto";
import { loadOrCreateInstallationIdentity } from "./installationIdentity";
import { readLicenseText, writeLicenseText } from "./licenseStorage";
import { machineHashFromGuid, normalizeMachineGuid } from "./machineIdentity";
import { validateLicense } from "./licenseValidator";
import type { KeyProtector } from "./licenseTypes";

export type LicenseEvaluation = {
  openDatabase: boolean;
  registerBusinessIpc: boolean;
  startGateway: boolean;
  status: "licensed" | "unlicensed";
  devBypass?: boolean;
  licenseId?: string;
  customerName?: string;
  plan?: "offline-perpetual";
  installationCode: string | null;
  message: string;
  supportDetail: string | null;
  reason: string | null;
};

export function isLicenseGateEnabled(input: { isDev: boolean; posLicenseRequired?: string }): boolean {
  if (input.posLicenseRequired === "1") {
    return true;
  }
  return !input.isDev;
}

function unlicensed(
  reason: string,
  installationCode: string | null,
  licenseId?: string,
): LicenseEvaluation {
  return {
    openDatabase: false,
    registerBusinessIpc: false,
    startGateway: false,
    status: "unlicensed",
    licenseId,
    installationCode,
    message: customerLicenseMessage(reason),
    supportDetail: reason === "license-missing" ? null : reason,
    reason,
  };
}

function readOptionalLicenseId(license: unknown): string | undefined {
  if (!license || typeof license !== "object") {
    return undefined;
  }
  const payload = (license as { payload?: { licenseId?: unknown } }).payload;
  if (!payload || typeof payload.licenseId !== "string") {
    return undefined;
  }
  return /^RN-\d{4}-\d{6}$/.test(payload.licenseId) ? payload.licenseId : undefined;
}

export function evaluateLicenseGate(input: {
  userDataDir: string;
  protector: KeyProtector;
  readMachineGuid: () => string;
  vendorPublicKey: Buffer;
}): LicenseEvaluation {
  const identity = loadOrCreateInstallationIdentity(input.userDataDir, input.protector);
  const rawPublicKey = identity.ok ? identity.rawPublicKey : null;

  let machineHash: Buffer | null = null;
  try {
    machineHash = machineHashFromGuid(normalizeMachineGuid(input.readMachineGuid()));
  } catch {
    machineHash = null;
  }

  const installationCode =
    rawPublicKey && machineHash
      ? encodeInstallationCode(machineHash, installationPublicKeyHash(rawPublicKey))
      : null;

  if (!identity.ok) {
    return unlicensed(identity.reason, null);
  }
  if (!machineHash) {
    return unlicensed("machine-guid-unavailable", null);
  }

  const licenseText = readLicenseText(input.userDataDir);
  if (licenseText == null) {
    return unlicensed("license-missing", installationCode);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(licenseText);
  } catch {
    return unlicensed("license-malformed", installationCode);
  }

  const validated = validateLicense({
    license: parsed,
    identity: identity.file,
    machineHashHex: machineHash.toString("hex"),
    vendorPublicKey: input.vendorPublicKey,
    protector: input.protector,
  });
  if (!validated.valid) {
    return unlicensed(validated.reason, installationCode, readOptionalLicenseId(parsed));
  }

  return {
    openDatabase: true,
    registerBusinessIpc: true,
    startGateway: true,
    status: "licensed",
    licenseId: validated.licenseId,
    customerName: validated.customerName,
    plan: "offline-perpetual",
    installationCode,
    message: "",
    supportDetail: null,
    reason: null,
  };
}

export function importLicenseText(input: {
  userDataDir: string;
  protector: KeyProtector;
  readMachineGuid: () => string;
  vendorPublicKey: Buffer;
  licenseText: string;
}):
  | { ok: true; evaluation: LicenseEvaluation }
  | { ok: false; message: string; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.licenseText);
  } catch {
    return {
      ok: false,
      reason: "license-malformed",
      message: customerLicenseMessage("license-malformed"),
    };
  }

  const identity = loadOrCreateInstallationIdentity(input.userDataDir, input.protector);
  if (!identity.ok) {
    return {
      ok: false,
      reason: identity.reason,
      message: customerLicenseMessage(identity.reason),
    };
  }

  let machineHashHex = "";
  try {
    machineHashHex = machineHashFromGuid(normalizeMachineGuid(input.readMachineGuid())).toString("hex");
  } catch {
    return {
      ok: false,
      reason: "machine-guid-unavailable",
      message: customerLicenseMessage("machine-guid-unavailable"),
    };
  }

  const validated = validateLicense({
    license: parsed,
    identity: identity.file,
    machineHashHex,
    vendorPublicKey: input.vendorPublicKey,
    protector: input.protector,
  });
  if (!validated.valid) {
    return {
      ok: false,
      reason: validated.reason,
      message: customerLicenseMessage(validated.reason),
    };
  }

  writeLicenseText(input.userDataDir, input.licenseText);
  return {
    ok: true,
    evaluation: evaluateLicenseGate(input),
  };
}
