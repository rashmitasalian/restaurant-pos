import path from "path";

export const RENDERER_PROTOCOL = "restoniti";
export const RENDERER_HOST = "app";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function productionRendererUrl() {
  return `${RENDERER_PROTOCOL}://${RENDERER_HOST}/index.html`;
}

/** Chromium will not apply stylesheets unless Content-Type is text/css. */
export function mimeTypeForRendererFile(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/** Map restoniti://app/... to a file under the unpacked dist folder. */
export function rendererFileFromRequestUrl(requestUrl: string, rendererRoot: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${RENDERER_PROTOCOL}:`) {
    return null;
  }
  const relative = decodeURIComponent(url.pathname || "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  if (relative.split("/").includes("..")) {
    return null;
  }
  const resolved = path.resolve(rendererRoot, relative || "index.html");
  const root = path.resolve(rendererRoot);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}
