import fs from "fs";
import path from "path";

function orderBlock(source: string) {
  const start = source.indexOf("orders: {");
  const end = source.indexOf("customers:", start);
  if (start < 0 || end < 0) {
    throw new Error("orders bridge block was not found");
  }
  return source.slice(start, end);
}

function orderChannels(source: string) {
  const block = orderBlock(source);
  const channels = new Map<string, string>();
  const pattern =
    /([A-Za-z0-9]+):\s*(?:\([^)]*\)\s*)?=>\s*authInvoke\(\s*"([^"]+)"/g;
  for (const match of block.matchAll(pattern)) {
    channels.set(match[1], match[2]);
  }
  return channels;
}

describe("preload order bridge", () => {
  const ts = fs.readFileSync(path.join(__dirname, "preload.ts"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
  const tsOrders = orderChannels(ts);
  const jsOrders = orderChannels(js);

  it("exposes transferTable on the dev and production bridges", () => {
    expect(tsOrders.get("transferTable")).toBe("pos:orders:transfer-table");
    expect(jsOrders.get("transferTable")).toBe("pos:orders:transfer-table");
  });

  it("gives the JS bridge every order method the TS bridge exposes", () => {
    expect([...jsOrders.keys()].sort()).toEqual([...tsOrders.keys()].sort());
    for (const [method, channel] of tsOrders) {
      expect(jsOrders.get(method)).toBe(channel);
    }
  });
});
