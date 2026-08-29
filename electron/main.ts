import "./env";
import { app, BrowserWindow, ipcMain, dialog, session, Menu, type IpcMainInvokeEvent, type WebContents } from "electron";
import path from "path";
import http from "http";
import https from "https";
import fs from "fs";
import { registerPosIpc } from "./ipc/posIpc";
import { closeDb, initializeDatabase } from "./db/sqlite";
import { posService } from "./services/posService";
import { destroyMainSession, getMainSession, refreshMainSession } from "./services/sessionManager";
import { updateService } from "./services/updateService";
import { printPayload, type PrinterConfig } from "./printing/printService";
import type { Role } from "../src/shared/pos";

const startupHrStart = process.hrtime.bigint();

function startupElapsedMs() {
  return Number(process.hrtime.bigint() - startupHrStart) / 1_000_000;
}

function logStartupStage(stage: string, context?: Record<string, unknown>) {
  const elapsedMs = Number(startupElapsedMs().toFixed(1));
  const message = `[startup] ${stage}`;
  console.info(message, { elapsedMs, ...(context || {}) });
  writeLogToFile("info", message, { elapsedMs, ...(context || {}) });
}

// Treat the app as dev only when NODE_ENV != 'production' AND the app is not packaged.
// This prevents packaged releases from attempting to load the dev server.
const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;

function isAllowedRendererUrl(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    const isDevRenderer =
      isDev &&
      (parsed.origin.startsWith("http://localhost:") ||
        parsed.origin.startsWith("http://127.0.0.1:"));
    const isProdRenderer = !isDev && parsed.protocol === "file:";
    return isDevRenderer || isProdRenderer;
  } catch {
    return false;
  }
}

function denyPopupWindows(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function bindRendererNavigationGuard(contents: WebContents) {
  contents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedRendererUrl(targetUrl)) {
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event, targetUrl) => {
    if (!isAllowedRendererUrl(targetUrl)) {
      event.preventDefault();
    }
  });
}

const LOG_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);
const MAX_LOG_MESSAGE_CHARS = 8_192;
const MAX_LOG_CONTEXT_CHARS = 16_384;

// ── Configurable constants (set in .env / OS environment) ──────────────────────
const HOTEL_NAME = process.env.HOTEL_NAME ?? "";

// ── File-based logger for main process ─────────────────────────────────────────
function getLogDir(): string {
  try {
    return path.join(app.getPath("userData"), "logs");
  } catch (_) {
    return path.join(process.cwd(), "logs");
  }
}

function ensureLogDir() {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeLogToFile(level: string, message: string, context?: any) {
  try {
    ensureLogDir();
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(getLogDir(), `pos-${date}.log`);
    const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${context ? " " + JSON.stringify(context) : ""}\n`;
    fs.appendFileSync(logFile, entry);
  } catch (_) {
    // Best-effort — never crash because of logging
  }
}

// ── Uncaught exception / rejection handlers ──────────────────────────────────
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  writeLogToFile("fatal", `uncaughtException: ${error.stack || error}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  writeLogToFile("fatal", `unhandledRejection: ${reason}`);
});

// In dev, use a custom userData path to avoid GPU cache lock-file races on Windows.
if (isDev) {
  try {
    const userDataPath = path.join(process.cwd(), ".user-data");
    app.setPath("userData", userDataPath);
  } catch (e) {
    // ignore
  }
}

let mainWindow: BrowserWindow | null = null;

function configureStableUserDataPath() {
  if (isDev || process.env.POS_DB_PATH_OVERRIDE?.trim()) {
    return;
  }
  try {
    app.setPath("userData", path.join(app.getPath("appData"), "Restaurant POS"));
  } catch (e) {
    // Keep Electron's default path if appData is unavailable.
  }
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "..", "..", "build", "icon.ico"),
    path.join(process.cwd(), "build", "icon.ico"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function requireMainSession(event: IpcMainInvokeEvent, token?: string | null, roles?: Role[]) {
  const mainSession = getMainSession(token, event.sender.id);
  if (!mainSession) {
    throw new Error("auth-required");
  }
  const user = posService.getUserByUsername(mainSession.username);
  if (!user || user.active === false) {
    destroyMainSession(token);
    throw new Error("auth-required");
  }
  if (user.requirePasswordChange) {
    throw new Error("password-change-required");
  }
  if (roles?.length && !roles.includes(user.role)) {
    throw new Error("forbidden");
  }
  refreshMainSession(mainSession.token, user);
  return user;
}

async function waitForServer(url: string, timeoutMs = 15000) {
  const start = Date.now();
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";

  function checkOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = (isHttps ? https : http).request(
        {
          method: "GET",
          host: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + (parsed.search || ""),
          timeout: 2000,
        },
        (res) => {
          const ok = res.statusCode && res.statusCode < 500;
          res.resume();
          resolve(!!ok);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  while (Date.now() - start < timeoutMs) {
    const ok = await checkOnce();
    if (ok) {
      return true;
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function createWindow() {
  logStartupStage("createWindow:start");
  const icon = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      // Always use the JS shim for preload. The shim will register ts-node and require preload.ts during dev.
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  mainWindow.webContents.once("did-start-loading", () => {
    logStartupStage("renderer:did-start-loading");
  });
  mainWindow.webContents.once("dom-ready", () => {
    logStartupStage("renderer:dom-ready");
  });
  mainWindow.webContents.once("did-finish-load", () => {
    logStartupStage("renderer:did-finish-load");
  });
  mainWindow.once("ready-to-show", () => {
    logStartupStage("window:ready-to-show");
  });

  denyPopupWindows(mainWindow.webContents);
  bindRendererNavigationGuard(mainWindow.webContents);

  // ── Content Security Policy ──────────────────────────────────────────────
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';",
        ],
      },
    });
  });

  // Install React DevTools in dev (best-effort) — opt-in via INSTALL_REACT_DEVTOOLS env var
  if (isDev) {
    try {
      if (process.env.INSTALL_REACT_DEVTOOLS === "1") {
        const installer = require("electron-devtools-installer");

        await installer
          .default(installer.REACT_DEVELOPER_TOOLS)
          .then((name: any) => console.log("Added Extension:", name))
          .catch((e: any) => console.warn("DevTools install failed", e));
      }
    } catch (e) {
      // ignore devtools install errors
    }
  }

  if (isDev) {
    const devUrl = "http://localhost:5173";
    logStartupStage("renderer:wait-for-dev-server:start", { url: devUrl });
    const ready = await waitForServer(devUrl, 15000);
    if (!ready) {
      throw new Error("renderer-dev-server-not-ready");
    }
    logStartupStage("renderer:wait-for-dev-server:ready");
    mainWindow.loadURL(devUrl);
    if (process.env.POS_OPEN_DEVTOOLS === "1") {
      try {
        mainWindow.webContents.openDevTools({ mode: "right" });
      } catch (e) {
        // ignore if webContents not ready
      }
    }
  } else {
    // ── Production: load the built renderer from dist/ ──────────────────────
    const rendererPath = path.join(__dirname, "..", "..", "dist", "index.html");
    logStartupStage("renderer:load-file", { rendererPath });
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on("closed", () => {
    logStartupStage("window:closed");
    mainWindow = null;
  });
}

app.on("web-contents-created", (_event, contents) => {
  denyPopupWindows(contents);
});

app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(false);
});

app.whenReady().then(async () => {
  logStartupStage("app:whenReady");
  // POS shell: no File/Edit/View menu in production; dev keeps Alt-accessible bar via autoHideMenuBar.
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }
  configureStableUserDataPath();
  try {
    logStartupStage("db:init:start");
    await initializeDatabase();
    logStartupStage("db:init:done");
    logStartupStage("service:ensure-ready:start");
    posService.ensureReady();
    logStartupStage("service:ensure-ready:done");
    logStartupStage("updates:startup-state:start");
    updateService.processStartupState();
    logStartupStage("updates:startup-state:done");
    logStartupStage("ipc:register:start");
    registerPosIpc(() => mainWindow);
    logStartupStage("ipc:register:done");
    await createWindow();
    logStartupStage("createWindow:done");
  } catch (err: any) {
    writeLogToFile("fatal", `Startup failed: ${err?.stack || err}`);
    dialog.showErrorBox(
      "Startup Error",
      `The application could not start properly.\n\n${err?.message || err}\n\nPlease check disk space and file permissions, then restart the app.`,
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDb();
});

async function getPrinterConfig(): Promise<PrinterConfig> {
  try {
    const cfg = (posService.getSetting("config:printers") as any) || {};
    return {
      kitchenPrinterName:
        String(cfg.kitchenPrinterIp || "").trim() || process.env.KITCHEN_PRINTER_USB_NAME || "POS-80C",
      counterPrinterName:
        String(cfg.counterPrinterIp || "").trim() || process.env.COUNTER_PRINTER_USB_NAME || "POS-80C",
      printerPort: Number(cfg.printerPort || process.env.PRINTER_PORT || 9100),
    };
  } catch (e) {
    return {
      kitchenPrinterName: process.env.KITCHEN_PRINTER_USB_NAME || "POS-80C",
      counterPrinterName: process.env.COUNTER_PRINTER_USB_NAME || "POS-80C",
      printerPort: Number(process.env.PRINTER_PORT || 9100),
    };
  }
}

// Printer IPC sends ESC/POS bytes through the supported RAW paths in printService.
ipcMain.handle("printer:print", async (event, token: string | null, payload) => {
  requireMainSession(event, token);
  console.log(
    "[PRINT] printer:print IPC received. payload type:",
    payload?.type,
    "| printer:",
    payload?.printer,
  );

  try {
    const cfg = await getPrinterConfig();
    const result = await printPayload(payload, cfg, { hotelName: HOTEL_NAME });
    console.log(`[PRINT] RAW ESC/POS path succeeded via ${result.transport}.`);
    return { ok: true, ...result };
  } catch (err: any) {
    console.error("[PRINT] RAW ESC/POS path failed:", err);
    return { ok: false, error: err?.message || String(err) };
  }
});
// Log IPC: persist renderer logs to file
ipcMain.handle("log:write", async (event, token: string | null, level: string, message: string, context?: any) => {
  requireMainSession(event, token);
  const safeLevel = LOG_LEVELS.has(String(level || "").toLowerCase())
    ? String(level).toLowerCase()
    : "info";
  const safeMessage = String(message || "").slice(0, MAX_LOG_MESSAGE_CHARS);
  let safeContext: unknown;
  try {
    const serialized = JSON.stringify(context);
    safeContext =
      serialized && serialized.length > MAX_LOG_CONTEXT_CHARS
        ? { truncated: true, preview: serialized.slice(0, MAX_LOG_CONTEXT_CHARS) }
        : context;
  } catch {
    safeContext = { unserializable: true };
  }
  writeLogToFile(safeLevel, safeMessage, safeContext);
  return { ok: true };
});

// Report PDF export: render HTML to PDF via printToPDF and save via native save dialog
ipcMain.handle("report:exportPdf", async (event, token: string | null, html: string, defaultFileName: string) => {
  requireMainSession(event, token, ["admin"]);
  let pdfWin: BrowserWindow | null = null;
  let tmpFile: string | null = null;
  try {
    const os = require("os");
    tmpFile = path.join(os.tmpdir(), `pos-report-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, "utf-8");

    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        javascript: false,
        allowRunningInsecureContent: false,
      },
    });
    pdfWin.webContents.once("did-finish-load", () => {
      pdfWin!.webContents.on("will-navigate", (navEvent) => navEvent.preventDefault());
      pdfWin!.webContents.on("will-redirect", (redirectEvent) => redirectEvent.preventDefault());
    });

    await new Promise<void>((resolve, reject) => {
      pdfWin!.webContents.once("did-finish-load", resolve);
      pdfWin!.webContents.once("did-fail-load", (_e, code, desc) =>
        reject(new Error(`Page load failed: ${desc} (${code})`)),
      );
      pdfWin!.loadFile(tmpFile!);
    });

    const pdfBuffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const safeName = defaultFileName.replace(/[^a-z0-9\-_]/gi, "-").toLowerCase();
    const defaultPath = path.join(app.getPath("documents"), `${safeName}-${timestamp}.pdf`);

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save PDF",
      defaultPath,
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, reason: "cancelled" };
    }

    fs.writeFileSync(result.filePath, pdfBuffer);
    console.log(`[REPORT-PDF] Saved to ${result.filePath}`);
    return { ok: true, path: result.filePath };
  } catch (err: any) {
    console.error("[REPORT-PDF] Failed:", err);
    return { ok: false, error: (err && err.message) || String(err) };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) {
pdfWin.destroy();
}
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {
        /* best-effort */
      }
    }
  }
});
