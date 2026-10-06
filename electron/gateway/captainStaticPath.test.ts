import path from "path";
import { resolveCaptainStaticPath } from "./captainStaticPath";

const root = path.resolve("C:\\app\\dist");

function resolved(pathname: string) {
  return resolveCaptainStaticPath(root, pathname);
}

describe("captain static paths", () => {
  it("serves captain files from inside the dist root", () => {
    expect(resolved("/captain/index.html")).toBe(path.join(root, "captain", "index.html"));
    expect(resolved("/")).toBe(path.join(root, "captain", "index.html"));
  });

  it("keeps parent-segment and encoded paths inside the dist root", () => {
    const cases = [
      "/captain/../../../Windows/win.ini",
      "/captain/..\\..\\..\\Windows\\win.ini",
      "/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini",
      "/assets/../../../Windows/win.ini",
      "/captain/../../dist-backup/secret.txt",
      "/foo/../../../../Windows/win.ini",
    ];
    for (const pathname of cases) {
      const filePath = resolved(pathname);
      const inside =
        filePath !== null &&
        (filePath === root || filePath.startsWith(root + path.sep)) &&
        !filePath.startsWith(`${root}-`);
      expect(inside).toBe(true);
      expect(filePath).not.toBe("C:\\Windows\\win.ini");
    }
  });

  it("rejects null bytes", () => {
    expect(resolved("/captain/index.html%00.txt")).toBeNull();
  });
});
