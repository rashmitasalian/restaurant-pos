import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { encodeInstallationCode } from "./installationCode";
import { buildLicenseDocument, generateTestVendorKeyPair } from "./licenseDocument";
import { evaluateLicenseGate, importLicenseText, isLicenseGateEnabled } from "./licenseGate";
import { installationPublicKeyHash, rawPublicKeyFromPem } from "./licenseCrypto";
import { identityFilePath, parseIdentityFile } from "./installationIdentity";
import { licenseFilePath } from "./licenseStorage";
import { machineHashFromGuid, normalizeMachineGuid } from "./machineIdentity";
import { signLicensePayload } from "./licenseCrypto";
import { validateLicense } from "./licenseValidator";
import type { IdentityFile, KeyProtector } from "./licenseTypes";
import { vendorPublicKeyRaw } from "./publicKey";

const MACHINE_A = "00112233-4455-6677-8899-aabbccddeeff";
const MACHINE_B = "ffeeddcc-bbaa-9988-7766-554433221100";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pos-license-"));
}

function memoryProtector(failDecrypt = false) {
  let decrypts = 0;
  const protector: KeyProtector = {
    isAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain, "utf8"),
    decryptString: (encrypted) => {
      decrypts += 1;
      if (failDecrypt) {
        throw new Error("dpapi-user");
      }
      return encrypted.toString("utf8");
    },
  };
  return { protector, decrypts: () => decrypts };
}

function guidReader(guid: string) {
  return () => guid;
}

function licenseFor(input: {
  userDataDir: string;
  guid: string;
  vendorPrivateKeyPem: string;
  customerName?: string;
}) {
  const identity = parseIdentityFile(fs.readFileSync(identityFilePath(input.userDataDir), "utf8"));
  if (!identity) {
    throw new Error("identity-missing");
  }
  const code = encodeInstallationCode(
    machineHashFromGuid(normalizeMachineGuid(input.guid)),
    installationPublicKeyHash(identity.rawPublicKey),
  );
  return buildLicenseDocument({
    customerName: input.customerName ?? "Example Restaurant",
    installationCode: code,
    licenseId: "RN-2026-000123",
    issuedAt: "2026-09-29T00:00:00.000Z",
    privateKeyPem: input.vendorPrivateKeyPem,
  });
}

describe("license gate", () => {
  it("does not read a renderer environment flag", () => {
    expect(isLicenseGateEnabled({ isDev: true })).toBe(false);
    expect(isLicenseGateEnabled({ isDev: true, posLicenseRequired: "1" })).toBe(true);
    expect(isLicenseGateEnabled({ isDev: false })).toBe(true);
    expect(
      isLicenseGateEnabled({
        isDev: true,
        posLicenseRequired: undefined,
        ...({ viteLicense: "1" } as object),
      } as { isDev: boolean; posLicenseRequired?: string }),
    ).toBe(false);
  });

  it("shows an installation code for a new install without proof-of-possession", () => {
    const dir = tempDir();
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    const first = evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    const second = evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    expect(first.reason).toBe("license-missing");
    expect(first.installationCode).toMatch(/^RN1-/);
    expect(first.registerBusinessIpc).toBe(false);
    expect(first.startGateway).toBe(false);
    expect(first.openDatabase).toBe(false);
    expect(second.installationCode).toBe(first.installationCode);
    expect(keys.decrypts()).toBe(0);
    expect(fs.existsSync(licenseFilePath(dir))).toBe(false);
  });

  it("accepts a matching perpetual license and starts POS services", () => {
    const dir = tempDir();
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    const document = licenseFor({
      userDataDir: dir,
      guid: MACHINE_A,
      vendorPrivateKeyPem: vendor.privateKeyPem,
    });
    const imported = importLicenseText({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
      licenseText: document,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    expect(imported.evaluation.status).toBe("licensed");
    expect(imported.evaluation.registerBusinessIpc).toBe(true);
    expect(imported.evaluation.startGateway).toBe(true);
    expect(imported.evaluation.openDatabase).toBe(true);
    expect(imported.evaluation.licenseId).toBe("RN-2026-000123");
    expect(keys.decrypts()).toBeGreaterThan(0);
  });

  it("rejects another installation and does not register business IPC", () => {
    const source = tempDir();
    const other = tempDir();
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    const base = {
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    };
    evaluateLicenseGate({ ...base, userDataDir: source });
    const document = licenseFor({
      userDataDir: source,
      guid: MACHINE_A,
      vendorPrivateKeyPem: vendor.privateKeyPem,
    });
    fs.mkdirSync(path.join(other, "data"), { recursive: true });
    fs.writeFileSync(path.join(other, "data", "restaurant-pos.sqlite"), "not-a-license");
    evaluateLicenseGate({ ...base, userDataDir: other });
    const imported = importLicenseText({
      ...base,
      userDataDir: other,
      licenseText: document,
    });
    expect(imported.ok).toBe(false);
    if (imported.ok) {
      return;
    }
    expect(imported.reason).toBe("installation-mismatch");
    expect(fs.existsSync(licenseFilePath(other))).toBe(false);
    const evaluation = evaluateLicenseGate({ ...base, userDataDir: other });
    expect(evaluation.registerBusinessIpc).toBe(false);
    expect(evaluation.startGateway).toBe(false);
    expect(evaluation.openDatabase).toBe(false);
  });

  it("keeps a corrupt identity file and does not generate a replacement", () => {
    const dir = tempDir();
    const filePath = identityFilePath(dir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{ not json");
    const before = fs.readFileSync(filePath);
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    const evaluation = evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    expect(evaluation.reason).toBe("identity-unreadable");
    expect(evaluation.installationCode).toBeNull();
    expect(evaluation.registerBusinessIpc).toBe(false);
    expect(fs.readFileSync(filePath).equals(before)).toBe(true);
    expect(keys.decrypts()).toBe(0);
  });

  it("treats a deleted identity as a new installation that needs a new license", () => {
    const dir = tempDir();
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    const base = {
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    };
    evaluateLicenseGate(base);
    const document = licenseFor({
      userDataDir: dir,
      guid: MACHINE_A,
      vendorPrivateKeyPem: vendor.privateKeyPem,
    });
    fs.writeFileSync(licenseFilePath(dir), document);
    fs.rmSync(identityFilePath(dir));
    const evaluation = evaluateLicenseGate(base);
    expect(fs.existsSync(identityFilePath(dir))).toBe(true);
    expect(evaluation.reason).toBe("installation-mismatch");
    expect(evaluation.registerBusinessIpc).toBe(false);
    expect(evaluation.startGateway).toBe(false);
  });

  it("does not replace an identity another Windows account cannot decrypt", () => {
    const dir = tempDir();
    const vendor = generateTestVendorKeyPair();
    const owner = memoryProtector();
    evaluateLicenseGate({
      userDataDir: dir,
      protector: owner.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    const document = licenseFor({
      userDataDir: dir,
      guid: MACHINE_A,
      vendorPrivateKeyPem: vendor.privateKeyPem,
    });
    fs.writeFileSync(licenseFilePath(dir), document);
    const before = fs.readFileSync(identityFilePath(dir));
    const otherUser = memoryProtector(true);
    const evaluation = evaluateLicenseGate({
      userDataDir: dir,
      protector: otherUser.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    expect(evaluation.reason).toBe("identity-unreadable");
    expect(evaluation.registerBusinessIpc).toBe(false);
    expect(evaluation.startGateway).toBe(false);
    expect(fs.readFileSync(identityFilePath(dir)).equals(before)).toBe(true);
  });

  it("changes the installation code when the machine GUID changes", () => {
    const dir = tempDir();
    const keys = memoryProtector();
    const vendor = generateTestVendorKeyPair();
    const first = evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_A),
      vendorPublicKey: vendor.publicKey,
    });
    const second = evaluateLicenseGate({
      userDataDir: dir,
      protector: keys.protector,
      readMachineGuid: guidReader(MACHINE_B),
      vendorPublicKey: vendor.publicKey,
    });
    expect(first.installationCode).not.toBe(second.installationCode);
  });
});

describe("validateLicense", () => {
  function licensedFixture() {
    const vendor = generateTestVendorKeyPair();
    const installation = crypto.generateKeyPairSync("ed25519");
    const privateKeyPem = installation.privateKey.export({ type: "pkcs8", format: "pem" });
    if (typeof privateKeyPem !== "string") {
      throw new Error("pem");
    }
    const rawPublic = rawPublicKeyFromPem(privateKeyPem);
    const keys = memoryProtector();
    const identity: IdentityFile = {
      version: 1,
      publicKey: rawPublic.toString("base64"),
      privateKeyProtected: keys.protector.encryptString(privateKeyPem).toString("base64"),
    };
    const machineHash = machineHashFromGuid(normalizeMachineGuid(MACHINE_A));
    const document = buildLicenseDocument({
      customerName: "Example Restaurant",
      installationCode: encodeInstallationCode(machineHash, installationPublicKeyHash(rawPublic)),
      licenseId: "RN-2026-000123",
      issuedAt: "2026-09-29T00:00:00.000Z",
      privateKeyPem: vendor.privateKeyPem,
    });
    const license = JSON.parse(document) as {
      payload: Record<string, unknown>;
      signature: string;
    };
    return { vendor, keys, identity, machineHash, license, rawPublic };
  }

  function validateWith(
    fixture: ReturnType<typeof licensedFixture>,
    license: unknown,
    machineHashHex = fixture.machineHash.toString("hex"),
  ) {
    return validateLicense({
      license,
      identity: fixture.identity,
      machineHashHex,
      vendorPublicKey: fixture.vendor.publicKey,
      protector: fixture.keys.protector,
    });
  }

  it("accepts a valid perpetual license", () => {
    const fixture = licensedFixture();
    const result = validateWith(fixture, fixture.license);
    expect(result).toEqual({
      valid: true,
      licenseId: "RN-2026-000123",
      customerName: "Example Restaurant",
    });
  });

  it("rejects a bad signature and any flipped signed field", () => {
    const fixture = licensedFixture();
    const badSignature = {
      ...fixture.license,
      signature: Buffer.alloc(64, 1).toString("base64"),
    };
    expect(validateWith(fixture, badSignature)).toEqual({
      valid: false,
      reason: "signature-invalid",
    });
    for (const field of [
      "licenseId",
      "customerName",
      "plan",
      "issuedAt",
      "installationPublicKeyHash",
      "machineHash",
    ]) {
      const payload = { ...fixture.license.payload, [field]: flipped(fixture.license.payload[field]) };
      expect(validateWith(fixture, { payload, signature: fixture.license.signature })).toEqual({
        valid: false,
        reason: "signature-invalid",
      });
    }
    const perpetual = {
      payload: { ...fixture.license.payload, perpetual: false },
      signature: fixture.license.signature,
    };
    expect(validateWith(fixture, perpetual)).toEqual({ valid: false, reason: "signature-invalid" });
  });

  it("rejects the wrong product before trusting the signature", () => {
    const fixture = licensedFixture();
    const fields = signedFields(fixture.license.payload);
    fields.product = "something-else";
    const signature = signLicensePayload(fields, fixture.vendor.privateKeyPem);
    expect(validateWith(fixture, { payload: { licenseVersion: 1, ...fields }, signature })).toEqual({
      valid: false,
      reason: "wrong-product",
    });
  });

  it("rejects a signed non-perpetual license", () => {
    const fixture = licensedFixture();
    const fields = signedFields(fixture.license.payload);
    fields.perpetual = false;
    const signature = signLicensePayload(fields, fixture.vendor.privateKeyPem);
    expect(
      validateWith(fixture, {
        payload: { licenseVersion: 1, ...fields },
        signature,
      }),
    ).toEqual({ valid: false, reason: "not-perpetual" });
  });

  it("rejects an unsupported version, a malformed file, the wrong machine, and the wrong installation", () => {
    const fixture = licensedFixture();
    expect(
      validateWith(fixture, {
        payload: { ...fixture.license.payload, licenseVersion: 2 },
        signature: fixture.license.signature,
      }),
    ).toEqual({ valid: false, reason: "unsupported-license-version" });
    expect(validateWith(fixture, { payload: {} })).toEqual({
      valid: false,
      reason: "license-malformed",
    });

    const otherMachine = machineHashFromGuid(normalizeMachineGuid(MACHINE_B));
    const machineDocument = JSON.parse(
      buildLicenseDocument({
        customerName: "Example Restaurant",
        installationCode: encodeInstallationCode(
          otherMachine,
          installationPublicKeyHash(fixture.rawPublic),
        ),
        licenseId: "RN-2026-000123",
        issuedAt: "2026-09-29T00:00:00.000Z",
        privateKeyPem: fixture.vendor.privateKeyPem,
      }),
    );
    expect(validateWith(fixture, machineDocument)).toEqual({
      valid: false,
      reason: "machine-mismatch",
    });

    const otherInstall = crypto.randomBytes(32);
    const installDocument = JSON.parse(
      buildLicenseDocument({
        customerName: "Example Restaurant",
        installationCode: encodeInstallationCode(fixture.machineHash, otherInstall),
        licenseId: "RN-2026-000123",
        issuedAt: "2026-09-29T00:00:00.000Z",
        privateKeyPem: fixture.vendor.privateKeyPem,
      }),
    );
    expect(validateWith(fixture, installDocument)).toEqual({
      valid: false,
      reason: "installation-mismatch",
    });
  });

  it("returns identity-unreadable when decrypt fails and leaves the reason specific", () => {
    const fixture = licensedFixture();
    const failing = memoryProtector(true);
    const result = validateLicense({
      license: fixture.license,
      identity: fixture.identity,
      machineHashHex: fixture.machineHash.toString("hex"),
      vendorPublicKey: fixture.vendor.publicKey,
      protector: failing.protector,
    });
    expect(result).toEqual({ valid: false, reason: "identity-unreadable" });
  });

  it("embeds a 32-byte vendor public key", () => {
    expect(vendorPublicKeyRaw()).toHaveLength(32);
  });
});

function flipped(value: unknown): string {
  const text = String(value);
  if (/^[0-9a-f]{64}$/.test(text)) {
    return text[0] === "0" ? `1${text.slice(1)}` : `0${text.slice(1)}`;
  }
  if (text.startsWith("RN-")) {
    return text.replace(/1$/, "2").replace(/3$/, "4");
  }
  return `${text} x`;
}

function signedFields(payload: Record<string, unknown>) {
  return {
    licenseId: String(payload.licenseId),
    product: String(payload.product),
    customerName: String(payload.customerName),
    plan: String(payload.plan),
    perpetual: Boolean(payload.perpetual),
    issuedAt: String(payload.issuedAt),
    installationPublicKeyHash: String(payload.installationPublicKeyHash),
    machineHash: String(payload.machineHash),
  };
}
