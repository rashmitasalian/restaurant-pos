import { createGunzip, createGzip } from "zlib";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";

export async function gzipFile(sourcePath: string, targetPath: string) {
  await pipeline(
    createReadStream(sourcePath),
    createGzip({ level: 6 }),
    createWriteStream(targetPath),
  );
}

export async function gunzipFile(sourcePath: string, targetPath: string) {
  await pipeline(createReadStream(sourcePath), createGunzip(), createWriteStream(targetPath));
}
