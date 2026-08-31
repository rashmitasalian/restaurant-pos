import path from "path";
import { isInsideAsarArchive, resolveProductionRendererHtml } from "./rendererPath";

describe("resolveProductionRendererHtml", () => {
  const resourcesPath = "C:\\Program Files\\RestoBridge\\RestoNiti\\resources";
  const dirname = path.join(resourcesPath, "app.asar", "dist-electron", "electron");
  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "dist", "index.html");
  const packed = path.join(dirname, "..", "..", "dist", "index.html");

  it("treats packed asar paths as unusable for Chromium file://", () => {
    expect(isInsideAsarArchive(packed)).toBe(true);
    expect(isInsideAsarArchive(unpacked)).toBe(false);
  });

  it("loads the unpacked dist file in a packaged install", () => {
    const resolved = resolveProductionRendererHtml({
      resourcesPath,
      dirname,
      existsSync: (filePath) => filePath === unpacked || filePath === packed,
    });
    expect(resolved).toBe(unpacked);
  });

  it("rejects a path that only exists inside the asar", () => {
    expect(() =>
      resolveProductionRendererHtml({
        resourcesPath,
        dirname,
        existsSync: (filePath) => filePath === packed,
      }),
    ).toThrow(/renderer-not-found/);
  });
});
