import type { LicensePayloadFields } from "./licenseTypes";

/** Fixed field order. String fields use JSON.stringify so escaping matches on both sides. */
export function canonicalLicensePayload(payload: LicensePayloadFields): string {
  return (
    `{"licenseVersion":1,"licenseId":${JSON.stringify(payload.licenseId)},` +
    `"product":${JSON.stringify(payload.product)},` +
    `"customerName":${JSON.stringify(payload.customerName)},` +
    `"plan":${JSON.stringify(payload.plan)},` +
    `"perpetual":${payload.perpetual ? "true" : "false"},` +
    `"issuedAt":${JSON.stringify(payload.issuedAt)},` +
    `"installationPublicKeyHash":${JSON.stringify(payload.installationPublicKeyHash)},` +
    `"machineHash":${JSON.stringify(payload.machineHash)}}`
  );
}
