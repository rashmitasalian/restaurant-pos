import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import fs from "fs";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EncryptedPayload = {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
};

export function generateBackupKey(): Buffer {
  return randomBytes(32);
}

export function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error("invalid-backup-key");
  }
  const nonce = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: encrypted, nonce, tag };
}

export function decryptBuffer(payload: EncryptedPayload, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error("invalid-backup-key");
  }
  const decipher = createDecipheriv(ALGO, key, payload.nonce);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

export function encryptFileToBuffer(sourcePath: string, key: Buffer): EncryptedPayload {
  const plaintext = fs.readFileSync(sourcePath);
  return encryptBuffer(plaintext, key);
}

export function decryptToFile(payload: EncryptedPayload, key: Buffer, targetPath: string) {
  const plaintext = decryptBuffer(payload, key);
  fs.writeFileSync(targetPath, plaintext);
}

export { IV_LENGTH, TAG_LENGTH };
