import { inflateRawSync } from "zlib";
import { buildXlsx } from "../xlsxWrite";

function unzip(buffer: Buffer) {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    files.set(name, inflateRawSync(compressed));
    offset = start + compressedSize;
  }
  return files;
}

describe("xlsx writer", () => {
  it("writes worksheet strings, numbers, and dates", () => {
    const bytes = buildXlsx([
      {
        name: "Summary",
        rows: [["Period", "Today"], ["Net Sales", 120], ["When", new Date(Date.UTC(2026, 9, 6))]],
      },
    ]);
    const files = unzip(bytes);
    const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") || "";
    expect(sheet).toContain("Period");
    expect(sheet).toContain("Today");
    expect(sheet).toContain(">120<");
    expect(sheet).toContain('s="1"');
    expect(files.get("xl/workbook.xml")?.toString("utf8")).toContain('name="Summary"');
  });
});
