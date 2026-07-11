import { randomBytes } from "crypto";
import {
  createCredentialHash,
  normalizeRecoveryCode,
  SCRYPT_ALGO,
  verifyCredential,
} from "./credentials";

jest.setTimeout(20000);

describe("credential helpers", () => {
  it("creates and verifies new scrypt credentials", () => {
    const credential = createCredentialHash("StrongPass123");

    expect(credential.hashAlgo).toBe(SCRYPT_ALGO);
    expect(credential.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(credential.hash).toMatch(/^[a-f0-9]{128}$/);

    expect(
      verifyCredential("StrongPass123", {
        hash_algo: credential.hashAlgo,
        salt: credential.salt,
        password_hash: credential.hash,
      }),
    ).toEqual({ ok: true, needsUpgrade: false });
  });

  it("normalizes recovery code formatting before verification", () => {
    expect(normalizeRecoveryCode("abcd-1234 efgh")).toBe("ABCD1234EFGH");
  });

  it("fails closed for unknown credential algorithms", () => {
    expect(
      verifyCredential("StrongPass123", {
        hash_algo: "UNSUPPORTED",
        salt: randomBytes(16).toString("hex"),
        password_hash: "00",
      }),
    ).toEqual({ ok: false, needsUpgrade: false });
  });
});
