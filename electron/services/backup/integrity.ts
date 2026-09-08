import { createHash } from "crypto";
import { createReadStream } from "fs";

export function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function assertChecksum(actual: string, expected: string) {
  if (!actual || !expected || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("checksum-mismatch");
  }
}
