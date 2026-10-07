import { buildXlsx } from "../xlsxWrite";

function unzip(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= buffer.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(buffer.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength;
    if (method !== 0) {
      throw new Error(`expected a stored zip entry, got method ${method}`);
    }
    files.set(name, decoder.decode(buffer.subarray(start, start + size)));
    offset = start + size;
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
    const sheet = files.get("xl/worksheets/sheet1.xml") || "";
    expect(sheet).toContain("Period");
    expect(sheet).toContain("Today");
    expect(sheet).toContain(">120<");
    expect(sheet).toContain('s="1"');
    expect(files.get("xl/workbook.xml")).toContain('name="Summary"');
  });
});
