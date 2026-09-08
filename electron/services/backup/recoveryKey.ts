import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { createCredentialHash, verifyCredential } from "../credentials";
import { generateBackupKey } from "./encryption";

const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const WRAP_ALGO = "aes-256-gcm";

export type RecoveryMaterial = {
  recoveryKey: string;
  recoveryKeyNormalized: string;
  verifierAlgo: string;
  verifierSalt: string;
  verifierHash: string;
  wrappedBackupKey: string;
  keyVersion: number;
};

function toCrockford(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function formatRecoveryKey(raw: Buffer) {
  const encoded = toCrockford(raw);
  const groups: string[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    groups.push(encoded.slice(i, i + 4));
  }
  return groups.join("-");
}

export function normalizeRecoveryKey(input: string) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[ILO]/g, (ch) => {
      if (ch === "I" || ch === "L") return "1";
      if (ch === "O") return "0";
      return ch;
    });
}

export function generateRecoveryKeyBytes(byteLength = 16) {
  return randomBytes(byteLength);
}

function deriveWrapKey(recoveryKeyNormalized: string) {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(recoveryKeyNormalized, "utf8"), Buffer.from("restoniti-backup-v1"), "backup-key-wrap", 32),
  );
}

export function wrapBackupKey(backupKey: Buffer, recoveryKeyNormalized: string) {
  const wrapKey = deriveWrapKey(recoveryKeyNormalized);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(WRAP_ALGO, wrapKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(backupKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString("base64");
}

export function unwrapBackupKey(wrappedBackupKey: string, recoveryKeyNormalized: string) {
  const wrapKey = deriveWrapKey(recoveryKeyNormalized);
  const blob = Buffer.from(wrappedBackupKey, "base64");
  if (blob.length < 12 + 16 + 1) {
    throw new Error("invalid-wrapped-backup-key");
  }
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv(WRAP_ALGO, wrapKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createRecoveryMaterial(backupKey?: Buffer, keyVersion = 1): RecoveryMaterial {
  const key = backupKey || generateBackupKey();
  const recoveryBytes = generateRecoveryKeyBytes(16);
  const recoveryKey = formatRecoveryKey(recoveryBytes);
  const recoveryKeyNormalized = normalizeRecoveryKey(recoveryKey);
  const verifier = createCredentialHash(recoveryKeyNormalized);
  return {
    recoveryKey,
    recoveryKeyNormalized,
    verifierAlgo: verifier.hashAlgo,
    verifierSalt: verifier.salt,
    verifierHash: verifier.hash,
    wrappedBackupKey: wrapBackupKey(key, recoveryKeyNormalized),
    keyVersion,
  };
}

export function verifyRecoveryKey(
  recoveryKeyInput: string,
  stored: { hash_algo: string; salt: string; password_hash: string },
) {
  const normalized = normalizeRecoveryKey(recoveryKeyInput);
  return verifyCredential(normalized, {
    hash_algo: stored.hash_algo,
    salt: stored.salt,
    password_hash: stored.password_hash,
  });
}

/** Server-side style hash of installation token (same scrypt parameters as credentials). */
export function hashInstallationToken(token: string) {
  return createCredentialHash(token);
}

export function generateInstallationToken() {
  return randomBytes(32).toString("base64url");
}

export function constantTimeEqualString(a: string, b: string) {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hmacSha256Hex(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Lightweight local verifier hash for tests without full scrypt when needed. Prefer createCredentialHash. */
export function deriveVerifierForTests(secret: string, saltHex: string) {
  return scryptSync(secret, Buffer.from(saltHex, "hex"), 64, {
    N: 2 ** 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex");
}
