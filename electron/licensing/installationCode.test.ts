import crypto from "crypto";
import {
  decodeInstallationCode,
  encodeInstallationCode,
  InstallationCodeError,
} from "./installationCode";

function hash(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

describe("installation code", () => {
  it("round-trips both hashes without truncation", () => {
    const machineHash = crypto.randomBytes(32);
    const installationPublicKeyHash = crypto.randomBytes(32);
    const code = encodeInstallationCode(machineHash, installationPublicKeyHash);
    const decoded = decodeInstallationCode(code);
    expect(decoded.machineHash.equals(machineHash)).toBe(true);
    expect(decoded.installationPublicKeyHash.equals(installationPublicKeyHash)).toBe(true);
    const body = code.slice(4).replace(/-/g, "");
    expect(body).toHaveLength(104);
    expect(code.startsWith("RN1-")).toBe(true);
    expect(code.split("-")).toHaveLength(27);
    expect(code.split("-").slice(1).every((group) => group.length === 4)).toBe(true);
  });

  it("is stable and changes when either hash changes", () => {
    const machineHash = hash(1);
    const installationPublicKeyHash = hash(2);
    const code = encodeInstallationCode(machineHash, installationPublicKeyHash);
    expect(encodeInstallationCode(machineHash, installationPublicKeyHash)).toBe(code);
    expect(encodeInstallationCode(hash(3), installationPublicKeyHash)).not.toBe(code);
    expect(encodeInstallationCode(machineHash, hash(4))).not.toBe(code);
  });

  it("rejects a short code, a bad character, and non-zero padding bits", () => {
    expect(() => decodeInstallationCode("RN1-ABCD")).toThrow(InstallationCodeError);
    const code = encodeInstallationCode(hash(9), hash(8));
    const noisy = `${code.slice(0, 8)}I${code.slice(9)}`;
    expect(() => decodeInstallationCode(noisy)).toThrow(InstallationCodeError);

    const body = code.slice(4).replace(/-/g, "");
    const padded = `${body.slice(0, 51)}1${body.slice(52)}`;
    const grouped = `RN1-${padded.match(/.{4}/g)?.join("-")}`;
    try {
      decodeInstallationCode(grouped);
      throw new Error("expected padding rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(InstallationCodeError);
      expect((error as InstallationCodeError).code).toBe("padding");
    }
  });
});
