import path from "path";

/**
 * Map a Captain request path onto a file inside `root`.
 * Returns null when the path would leave that directory.
 */
export function resolveCaptainStaticPath(root: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) {
    return null;
  }
  if (rel === "/" || rel === "") {
    rel = "/captain/index.html";
  } else if (!rel.startsWith("/assets/") && !rel.startsWith("/captain/")) {
    rel = `/captain${rel.startsWith("/") ? rel : `/${rel}`}`;
  }

  const normalized = path.normalize(rel).replace(/^[/\\]+/, "");
  if (!normalized || normalized.split(/[/\\]/).includes("..")) {
    return null;
  }

  const base = path.resolve(root);
  const filePath = path.resolve(base, normalized);
  const relative = path.relative(base, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}
