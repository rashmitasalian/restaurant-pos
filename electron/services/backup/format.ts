import fs from "fs";
import { BACKUP_FORMAT_VERSION, RnBakHeader } from "./types";
import { EncryptedPayload, TAG_LENGTH } from "./encryption";
import { assertChecksum, sha256Buffer } from "./integrity";

const MAGIC = Buffer.from("RNBAK1\0");

export function buildRnBakHeader(partial: Omit<RnBakHeader, "backupFormatVersion">): RnBakHeader {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    ...partial,
  };
}

export function writeRnBakFile(targetPath: string, header: RnBakHeader, payload: EncryptedPayload) {
  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32BE(headerJson.length, 0);
  // ciphertext already excludes tag; append tag after ciphertext for authenticated decryption
  const body = Buffer.concat([payload.ciphertext, payload.tag]);
  const file = Buffer.concat([MAGIC, headerLen, headerJson, body]);
  fs.writeFileSync(targetPath, file);
  return file.length;
}

export function readRnBakFile(sourcePath: string): { header: RnBakHeader; payload: EncryptedPayload } {
  const file = fs.readFileSync(sourcePath);
  if (file.length < MAGIC.length + 4 + TAG_LENGTH) {
    throw new Error("invalid-rnbak");
  }
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("invalid-rnbak-magic");
  }
  const headerLen = file.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerEnd = headerStart + headerLen;
  if (headerEnd > file.length - TAG_LENGTH) {
    throw new Error("invalid-rnbak-header");
  }
  let header: RnBakHeader;
  try {
    header = JSON.parse(file.subarray(headerStart, headerEnd).toString("utf8")) as RnBakHeader;
  } catch {
    throw new Error("invalid-rnbak-header-json");
  }
  if (header.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("unsupported-rnbak-version");
  }
  const body = file.subarray(headerEnd);
  if (body.length < TAG_LENGTH) {
    throw new Error("invalid-rnbak-body");
  }
  const ciphertext = body.subarray(0, body.length - TAG_LENGTH);
  const tag = body.subarray(body.length - TAG_LENGTH);
  const actualChecksum = sha256Buffer(body);
  assertChecksum(actualChecksum, header.checksum);
  return {
    header,
    payload: {
      ciphertext,
      tag,
      nonce: Buffer.from(header.nonce, "base64"),
    },
  };
}

export function checksumEncryptedBody(payload: EncryptedPayload) {
  return sha256Buffer(Buffer.concat([payload.ciphertext, payload.tag]));
}
