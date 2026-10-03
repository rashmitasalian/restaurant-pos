import { customerLicenseMessage } from "./licenseErrors";
import { evaluateLicenseGate, importLicenseText, type LicenseEvaluation } from "./licenseGate";
import type { KeyProtector, LicenseStatus } from "./licenseTypes";

type Runtime = {
  gateEnabled: boolean;
  userDataDir: string;
  protector: KeyProtector;
  readMachineGuid: () => string;
  vendorPublicKey: Buffer;
  evaluation: LicenseEvaluation | null;
};

let runtime: Runtime | null = null;

export function configureLicenseRuntime(input: {
  gateEnabled: boolean;
  userDataDir: string;
  protector: KeyProtector;
  readMachineGuid: () => string;
  vendorPublicKey: Buffer;
}): LicenseEvaluation | null {
  const evaluation = input.gateEnabled
    ? evaluateLicenseGate({
        userDataDir: input.userDataDir,
        protector: input.protector,
        readMachineGuid: input.readMachineGuid,
        vendorPublicKey: input.vendorPublicKey,
      })
    : null;
  runtime = { ...input, evaluation };
  return evaluation;
}

export function licenseStatusForRenderer(): LicenseStatus {
  if (!runtime?.gateEnabled) {
    return { status: "licensed", devBypass: true };
  }
  const evaluation = runtime.evaluation;
  if (!evaluation || evaluation.status !== "licensed") {
    return {
      status: "unlicensed",
      message: evaluation?.message || customerLicenseMessage("license-missing"),
      supportDetail: evaluation?.supportDetail ?? null,
    };
  }
  return {
    status: "licensed",
    licenseId: evaluation.licenseId,
    customerName: evaluation.customerName,
    plan: "offline-perpetual",
  };
}

export function installationCodeForRenderer():
  | { ok: true; code: string }
  | { ok: false; message: string } {
  if (!runtime?.gateEnabled) {
    return { ok: false, message: "Licensing is not required in this build." };
  }
  const code = runtime.evaluation?.installationCode;
  if (!code) {
    return {
      ok: false,
      message: runtime.evaluation?.message || customerLicenseMessage("identity-unreadable"),
    };
  }
  return { ok: true, code };
}

export function importRuntimeLicense(licenseText: string) {
  if (!runtime?.gateEnabled) {
    return { ok: false as const, message: "Licensing is not required in this build.", reason: "dev-bypass" };
  }
  const imported = importLicenseText({
    userDataDir: runtime.userDataDir,
    protector: runtime.protector,
    readMachineGuid: runtime.readMachineGuid,
    vendorPublicKey: runtime.vendorPublicKey,
    licenseText,
  });
  if (imported.ok) {
    runtime.evaluation = imported.evaluation;
  }
  return imported;
}
