import path from "path";
import {
  mimeTypeForRendererFile,
  productionRendererUrl,
  rendererFileFromRequestUrl,
  RENDERER_PROTOCOL,
} from "./rendererProtocol";

describe("rendererProtocol", () => {
  const root = "C:\\Program Files\\RestoBridge\\RestoNiti\\resources\\app.asar.unpacked\\dist";

  it("builds a privileged production URL", () => {
    expect(productionRendererUrl()).toBe("restoniti://app/index.html");
  });

  it("maps index and asset URLs onto the unpacked dist folder", () => {
    expect(rendererFileFromRequestUrl("restoniti://app/index.html", root)).toBe(
      path.resolve(root, "index.html"),
    );
    expect(rendererFileFromRequestUrl("restoniti://app/assets/index.js", root)).toBe(
      path.resolve(root, "assets/index.js"),
    );
  });

  it("rejects path traversal and other schemes", () => {
    expect(
      rendererFileFromRequestUrl("restoniti://app/" + encodeURIComponent("..\\secret.txt"), root),
    ).toBeNull();
    expect(rendererFileFromRequestUrl("file:///C:/temp/index.html", root)).toBeNull();
  });

  it("uses the restoniti scheme constant", () => {
    expect(RENDERER_PROTOCOL).toBe("restoniti");
  });

  it("returns stylesheet MIME so Chromium will apply lazy CSS chunks", () => {
    expect(mimeTypeForRendererFile("C:\\app\\assets\\Reports.css")).toBe("text/css; charset=utf-8");
    expect(mimeTypeForRendererFile("C:\\app\\assets\\index.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(mimeTypeForRendererFile("C:\\app\\assets\\inter.woff2")).toBe("font/woff2");
  });
});
