import fs from "fs";
import os from "os";
import path from "path";
import { issuanceWarnings, LedgerError, nextLicenseId, readLedger, recordIssuance } from "./ledger";

function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-ledger-"));
  return path.join(dir, "license-ledger.jsonl");
}

const base = {
  customer: "Example Restaurant",
  installationPublicKeyHash: "ab",
  machineHash: "cd",
  issuedAt: "2026-09-29T00:00:00.000Z",
};

describe("license ledger", () => {
  it("marks only the license named in replaces as replaced", () => {
    const filePath = tempLedger();
    const first = recordIssuance(filePath, {
      ...base,
      licenseId: nextLicenseId([], new Date("2026-09-29T00:00:00.000Z")),
    });
    expect(first.licenseId).toBe("RN-2026-000001");
    const otherSite = recordIssuance(filePath, {
      ...base,
      customer: "Example Restaurant",
      licenseId: "RN-2026-000002",
      installationPublicKeyHash: "11",
      machineHash: "22",
    });
    expect(otherSite.replacementCount).toBe(0);

    const replacement = recordIssuance(filePath, {
      ...base,
      licenseId: "RN-2026-000003",
      installationPublicKeyHash: "ef",
      machineHash: "12",
      replaces: "RN-2026-000001",
      notes: "replacement PC",
    });
    expect(replacement.replacementCount).toBe(1);
    expect(replacement.replaces).toBe("RN-2026-000001");
    const rows = readLedger(filePath);
    expect(rows.find((row) => row.licenseId === "RN-2026-000001")?.status).toBe("replaced");
    expect(rows.find((row) => row.licenseId === "RN-2026-000002")?.status).toBe("active");
    expect(rows.find((row) => row.licenseId === "RN-2026-000003")?.status).toBe("active");
  });

  it("refuses a duplicate id and an unknown or already replaced license", () => {
    const filePath = tempLedger();
    recordIssuance(filePath, { ...base, licenseId: "RN-2026-000001" });
    expect(() => recordIssuance(filePath, { ...base, licenseId: "RN-2026-000001" })).toThrow(
      LedgerError,
    );
    expect(() =>
      recordIssuance(filePath, { ...base, licenseId: "RN-2026-000002", replaces: "RN-2026-000099" }),
    ).toThrow(LedgerError);
    recordIssuance(filePath, { ...base, licenseId: "RN-2026-000003", replaces: "RN-2026-000001" });
    expect(() =>
      recordIssuance(filePath, { ...base, licenseId: "RN-2026-000004", replaces: "RN-2026-000001" }),
    ).toThrow(LedgerError);
  });

  it("warns about a reused code and a same-name restaurant without replaces", () => {
    const filePath = tempLedger();
    recordIssuance(filePath, { ...base, licenseId: "RN-2026-000001" });
    const rows = readLedger(filePath);
    const warnings = issuanceWarnings(rows, {
      customer: "example restaurant",
      machineHash: "cd",
      installationPublicKeyHash: "ab",
    });
    expect(warnings).toHaveLength(2);
    expect(
      issuanceWarnings(rows, {
        customer: "Example Restaurant",
        machineHash: "99",
        installationPublicKeyHash: "88",
        replaces: "RN-2026-000001",
      }),
    ).toHaveLength(0);
  });
});
