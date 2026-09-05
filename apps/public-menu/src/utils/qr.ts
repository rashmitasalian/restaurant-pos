export function getPublicMenuBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_MENU_BASE_URL;
  const raw = typeof configured === "string" ? configured.trim() : "";
  const base = raw || window.location.origin;
  return base.replace(/\/+$/, "");
}

export function getPublicMenuUrl(slug: string): string {
  return `${getPublicMenuBaseUrl()}/menu/${encodeURIComponent(slug)}`;
}

export function isLocalhostMenuUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function downloadQrPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(href);
  }, "image/png");
}

export function printQr(): void {
  window.print();
}
