import { BrowserWindow, app } from "electron";
import path from "path";
import fs from "fs";
import { currentWindowBackground, resolvedTheme } from "./appearancePreference";

/** Splash ink. Light matches the warm workspace; dark matches html[data-theme="dark"] tokens. */
const BOOT_PALETTES = {
  light: {
    bg: "#f9f8f6",
    teal: "#0f5e68",
    tealDeep: "#0b4a52",
    barEnd: "#5f9ea5",
    tx: "#17202a",
    muted: "#64748b",
    track: "#f4f5f3",
  },
  dark: {
    bg: "#1c2124",
    teal: "#6eafb8",
    tealDeep: "#3d7f88",
    barEnd: "#8ac6ce",
    tx: "#e8e6e1",
    muted: "#9aa3a1",
    track: "#1a1f22",
  },
} as const;

export function windowBackgroundColor(): string {
  return currentWindowBackground();
}

function resolveBootMarkDataUrl(): string {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(app.getAppPath(), "build", "icon.ico"),
    path.join(__dirname, "..", "..", "build", "icon.ico"),
    path.join(__dirname, "..", "..", "src", "ui", "assets", "restoniti-icon.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) {
        continue;
      }
      const bytes = fs.readFileSync(candidate);
      const ext = path.extname(candidate).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".ico" ? "image/x-icon" : "application/octet-stream";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      // try next
    }
  }
  return "";
}

export function buildBootSplashHtml(caption = "Starting RestoNiti") {
  const palette = BOOT_PALETTES[resolvedTheme()];
  const mark = resolveBootMarkDataUrl();
  const markHtml = mark
    ? `<img class="mark-img" src="${mark}" alt="" width="42" height="42" />`
    : `<span class="mark" aria-hidden="true"></span>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RestoNiti</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${palette.bg};
      color: ${palette.tx};
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .boot {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 32px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mark, .mark-img {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      flex: 0 0 auto;
    }
    .mark {
      background: linear-gradient(135deg, ${palette.teal}, ${palette.tealDeep});
      box-shadow: 0 10px 24px rgba(15, 94, 104, 0.28);
      animation: pulse 1.4s ease-in-out infinite;
    }
    .mark-img {
      object-fit: contain;
      box-shadow: 0 10px 24px rgba(15, 94, 104, 0.18);
    }
    .wordmark {
      display: flex;
      gap: 2px;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .wordmark span:last-child { color: ${palette.teal}; }
    .track {
      width: min(220px, 70vw);
      height: 4px;
      border-radius: 999px;
      background: ${palette.track};
      overflow: hidden;
    }
    .bar {
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, ${palette.teal}, ${palette.barEnd});
      animation: slide 1.1s ease-in-out infinite;
    }
    .caption {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: ${palette.muted};
    }
    @keyframes slide {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(280%); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(0.96); opacity: 0.88; }
    }
  </style>
</head>
<body>
  <div class="boot" role="status" aria-live="polite">
    <div class="brand">
      ${markHtml}
      <div class="wordmark"><span>Resto</span><span>Niti</span></div>
    </div>
    <div class="track" aria-hidden="true"><div class="bar"></div></div>
    <p class="caption">${caption}</p>
  </div>
</body>
</html>`;
}

let bootSplashWindow: BrowserWindow | null = null;

export function openBootSplash(iconPath?: string | null) {
  if (bootSplashWindow && !bootSplashWindow.isDestroyed()) {
    return bootSplashWindow;
  }
  bootSplashWindow = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: true,
    center: true,
    backgroundColor: windowBackgroundColor(),
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  void bootSplashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildBootSplashHtml("Preparing RestoNiti"))}`,
  );
  bootSplashWindow.on("closed", () => {
    bootSplashWindow = null;
  });
  return bootSplashWindow;
}

export function closeBootSplash() {
  if (!bootSplashWindow || bootSplashWindow.isDestroyed()) {
    bootSplashWindow = null;
    return;
  }
  try {
    bootSplashWindow.close();
  } catch {
    // ignore
  }
  bootSplashWindow = null;
}
