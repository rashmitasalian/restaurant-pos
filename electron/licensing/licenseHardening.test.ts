import fs from "fs";
import os from "os";
import path from "path";
import { encodeInstallationCode } from "./installationCode";
import { identityFilePath, loadOrCreateInstallationIdentity } from "./installationIdentity";
import {
  buildLicenseDocument,
  generateTestVendorKeyPair,
  LicenseInputError,
} from "./licenseDocument";
import { evaluateLicenseGate } from "./licenseGate";
import { licenseFilePath, readLicenseText, writeLicenseText } from "./licenseStorage";
import { verifySignedLicense } from "./licenseValidator";
import { machineGuidFromRegOutput } from "./machineIdentity";
import type { KeyProtector } from "./licenseTypes";

const protector: KeyProtector = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, "utf8"),
  decryptString: (encrypted) => encrypted.toString("utf8"),
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pos-license-hard-"));
}

describe("installation identity creation", () => {
  it("keeps the identity another launch created first", () => {
    const dir = tempDir();
    const first = loadOrCreateInstallationIdentity(dir, protector);
    expect(first.ok && first.created).toBe(true);
    const before = fs.readFileSync(identityFilePath(dir), "utf8");

    const realExists = fs.existsSync;
    const spy = jest
      .spyOn(fs, "existsSync")
      .mockImplementation((target) =>
        String(target) === identityFilePath(dir) ? false : realExists(target),
      );
    try {
      const second = loadOrCreateInstallationIdentity(dir, protector);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.created).toBe(false);
        expect(second.rawPublicKey.equals(first.rawPublicKey)).toBe(true);
      }
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(identityFilePath(dir), "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(identityFilePath(dir))).filter((f) => f.endsWith(".tmp"))).toEqual(
      [],
    );
  });
});

describe("license file storage", () => {
  it("treats an oversized license as malformed, not missing", () => {
    const dir = tempDir();
    evaluateLicenseGate({
      userDataDir: dir,
      protector,
      readMachineGuid: () => "00112233-4455-6677-8899-aabbccddeeff",
      vendorPublicKey: generateTestVendorKeyPair().publicKey,
    });
    fs.writeFileSync(licenseFilePath(dir), "x".repeat(70_000));
    expect(readLicenseText(dir)).toBe("");
    const evaluation = evaluateLicenseGate({
      userDataDir: dir,
      protector,
      readMachineGuid: () => "00112233-4455-6677-8899-aabbccddeeff",
      vendorPublicKey: generateTestVendorKeyPair().publicKey,
    });
    expect(evaluation.reason).toBe("license-malformed");
  });

  it("replaces an existing license without leaving temp files", () => {
    const dir = tempDir();
    writeLicenseText(dir, "first");
    writeLicenseText(dir, "second");
    expect(readLicenseText(dir)).toBe("second\n");
    expect(fs.readdirSync(path.dirname(licenseFilePath(dir)))).toEqual(["license.rnlc"]);
  });
});

describe("machine GUID", () => {
  it("parses reg.exe output and rejects garbage", () => {
    const output =
      "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    00112233-4455-6677-8899-AABBCCDDEEFF\r\n";
    expect(machineGuidFromRegOutput(output)).toBe("00112233-4455-6677-8899-aabbccddeeff");
    expect(() => machineGuidFromRegOutput("nothing here")).toThrow("machine-guid-unavailable");
    expect(() => machineGuidFromRegOutput("MachineGuid REG_SZ not-a-guid")).toThrow();
  });
});

describe("issuer input checks", () => {
  const vendor = generateTestVendorKeyPair();
  const code = encodeInstallationCode(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  const valid = {
    customerName: "Example Restaurant",
    installationCode: code,
    licenseId: "RN-2026-000001",
    issuedAt: "2026-09-29T00:00:00.000Z",
    privateKeyPem: vendor.privateKeyPem,
  };

  it("produces a file the app's signed-license check accepts", () => {
    const document = JSON.parse(buildLicenseDocument(valid));
    expect(verifySignedLicense(document, vendor.publicKey).valid).toBe(true);
  });

  it("rejects a wrong product, an unsupported version, and a flipped signature the same way the POS does", () => {
    const document = JSON.parse(buildLicenseDocument(valid));
    expect(
      verifySignedLicense(
        { ...document, payload: { ...document.payload, product: "something-else" } },
        vendor.publicKey,
      ),
    ).toEqual({ valid: false, reason: "wrong-product" });
    expect(
      verifySignedLicense(
        { ...document, payload: { ...document.payload, licenseVersion: 2 } },
        vendor.publicKey,
      ),
    ).toEqual({ valid: false, reason: "unsupported-license-version" });
    expect(
      verifySignedLicense(
        { ...document, signature: Buffer.alloc(64, 7).toString("base64") },
        vendor.publicKey,
      ),
    ).toEqual({ valid: false, reason: "signature-invalid" });
  });

  it("refuses a bad license id, a blank or long name, and a bad date", () => {
    expect(() => buildLicenseDocument({ ...valid, licenseId: "RN-1" })).toThrow(LicenseInputError);
    expect(() => buildLicenseDocument({ ...valid, customerName: "" })).toThrow(LicenseInputError);
    expect(() => buildLicenseDocument({ ...valid, customerName: " Padded" })).toThrow(
      LicenseInputError,
    );
    expect(() => buildLicenseDocument({ ...valid, customerName: "x".repeat(201) })).toThrow(
      LicenseInputError,
    );
    expect(() => buildLicenseDocument({ ...valid, issuedAt: "yesterday" })).toThrow(
      LicenseInputError,
    );
  });
});
