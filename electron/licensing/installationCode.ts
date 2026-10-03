const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALPHABET_INDEX = new Map<string, number>(
  ALPHABET.split("").map((character, index) => [character, index]),
);

const HASH_CHARS = 52;
const BODY_CHARS = HASH_CHARS * 2;

export class InstallationCodeError extends Error {
  constructor(readonly code: "prefix" | "length" | "alphabet" | "padding") {
    super(code);
    this.name = "InstallationCodeError";
  }
}

function encodeHash(bytes: Buffer): string {
  if (bytes.length !== 32) {
    throw new Error("hash-length");
  }
  let bits = 0;
  let bitCount = 0;
  let out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const index = (bits >> bitCount) & 31;
      out += ALPHABET[index];
      bits &= (1 << bitCount) - 1;
    }
  }
  if (bitCount !== 1) {
    throw new Error("hash-bit-remainder");
  }
  const index = (bits << (5 - bitCount)) & 31;
  out += ALPHABET[index];
  if (out.length !== HASH_CHARS) {
    throw new Error("hash-char-length");
  }
  return out;
}

function decodeHash(chars: string): Buffer {
  if (chars.length !== HASH_CHARS) {
    throw new InstallationCodeError("length");
  }
  let bits = 0;
  let bitCount = 0;
  const out: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const value = ALPHABET_INDEX.get(chars[i]);
    if (value === undefined) {
      throw new InstallationCodeError("alphabet");
    }
    const isLast = i === chars.length - 1;
    if (isLast) {
      if ((value & 0b01111) !== 0) {
        throw new InstallationCodeError("padding");
      }
      bits = (bits << 1) | ((value >> 4) & 1);
      bitCount += 1;
    } else {
      bits = (bits << 5) | value;
      bitCount += 5;
    }
    while (bitCount >= 8) {
      bitCount -= 8;
      out.push((bits >> bitCount) & 255);
      bits &= (1 << bitCount) - 1;
    }
  }
  if (out.length !== 32 || bitCount !== 0) {
    throw new InstallationCodeError("padding");
  }
  return Buffer.from(out);
}

function groupBody(body: string): string {
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += 4) {
    groups.push(body.slice(i, i + 4));
  }
  return `RN1-${groups.join("-")}`;
}

export function encodeInstallationCode(machineHash: Buffer, installationPublicKeyHash: Buffer): string {
  return groupBody(encodeHash(machineHash) + encodeHash(installationPublicKeyHash));
}

export function decodeInstallationCode(code: string): {
  machineHash: Buffer;
  installationPublicKeyHash: Buffer;
} {
  const trimmed = code.trim();
  if (!trimmed.startsWith("RN1-")) {
    throw new InstallationCodeError("prefix");
  }
  const body = trimmed.slice(4).replace(/-/g, "").toUpperCase();
  if (body.length !== BODY_CHARS) {
    throw new InstallationCodeError("length");
  }
  if ([...body].some((character) => !ALPHABET_INDEX.has(character))) {
    throw new InstallationCodeError("alphabet");
  }
  return {
    machineHash: decodeHash(body.slice(0, HASH_CHARS)),
    installationPublicKeyHash: decodeHash(body.slice(HASH_CHARS)),
  };
}
