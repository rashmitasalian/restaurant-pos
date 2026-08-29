import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SCRYPT_ALGO = "SCRYPT-N131072-R8-P1";

const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 160 * 1024 * 1024,
};

export type StoredCredential = {
  hash_algo?: string | null;
  salt: string;
  password_hash?: string;
  code_hash?: string;
};

export type CredentialHash = {
  hashAlgo: string;
  salt: string;
  hash: string;
};

function constantTimeEqualsHex(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex || "", "hex");
  const right = Buffer.from(rightHex || "", "hex");
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function scryptHash(secret: string, saltHex: string) {
  return scryptSync(secret, Buffer.from(saltHex, "hex"), 64, SCRYPT_OPTIONS).toString("hex");
}

export function createCredentialHash(secret: string): CredentialHash {
  const salt = randomBytes(16).toString("hex");
  return {
    hashAlgo: SCRYPT_ALGO,
    salt,
    hash: scryptHash(secret, salt),
  };
}

export function verifyCredential(secret: string, stored: StoredCredential) {
  const hashAlgo = stored.hash_algo;
  const expected = stored.password_hash || stored.code_hash || "";
  if (hashAlgo !== SCRYPT_ALGO) {
    return { ok: false, needsUpgrade: false };
  }
  const actual = scryptHash(secret, stored.salt);

  return {
    ok: constantTimeEqualsHex(actual, expected),
    needsUpgrade: false,
  };
}

let dummyStored: StoredCredential | null = null;

function getDummyStored(): StoredCredential {
  if (!dummyStored) {
    const created = createCredentialHash(randomBytes(32).toString("hex"));
    dummyStored = {
      hash_algo: created.hashAlgo,
      salt: created.salt,
      password_hash: created.hash,
    };
  }
  return dummyStored;
}

export function verifyCredentialAgainstStored(secret: string, stored: StoredCredential | null) {
  if (stored) {
    return verifyCredential(secret, stored);
  }
  verifyCredential(secret, getDummyStored());
  return { ok: false, needsUpgrade: false };
}

export function normalizeRecoveryCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function generateRecoveryCode() {
  const raw = randomBytes(12).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") || raw;
}
