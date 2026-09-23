import "./env";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  dialog,
  session,
  Menu,
  protocol,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import path from "path";
import http from "http";
import https from "https";
import fs from "fs";
import { registerPosIpc } from "./ipc/posIpc";
import { closeDb, initializeDatabase } from "./db/sqlite";
import { posService } from "./services/posService";
import { configureDomainEvents } from "./services/domainEvents";
import {
  startLocalGateway,
  stopLocalGateway,
  getGatewayStatus,
  rotateGatewayPairingCode,
} from "./gateway/localGateway";
import { destroyMainSession, getMainSession, refreshMainSession } from "./services/sessionManager";
import { updateService } from "./services/updateService";
import { bootstrapBackupManager } from "./services/backup/bootstrap";
import { startBackupScheduler, stopBackupScheduler } from "./services/backup/scheduler";
import { printPayload, type PrinterConfig } from "./printing/printService";
import { listWindowsPrinters } from "./printing/windowsRaw";
import {
  DEFAULT_USB_PRINTER_NAME,
  isSelectablePosPrinter,
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
} from "../src/shared/printerConfig";
import { shutdownWindowsRawPrinter, warmUpWindowsRawPrinter } from "./printing/windowsRawWorker";
import { resolveProductionRendererHtml } from "./rendererPath";
import {
  mimeTypeForRendererFile,
  productionRendererUrl,
  rendererFileFromRequestUrl,
  RENDERER_PROTOCOL,
} from "./rendererProtocol";
import {
  BOOT_WINDOW_BACKGROUND,
  closeBootSplash,
  openBootSplash,
} from "./bootSplash";
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function isAllowedRendererUrl(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    const isDevRenderer =
      isDev &&
      (parsed.origin.startsWith("http://localhost:") ||
        parsed.origin.startsWith("http://127.0.0.1:"));
    const isProdRenderer =
      !isDev && (parsed.protocol === "file:" || parsed.protocol === `${RENDERER_PROTOCOL}:`);
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

let productionRendererRoot = "";
let rendererProtocolRegistered = false;

function registerProductionRendererProtocol(rendererRoot: string) {
  productionRendererRoot = rendererRoot;
  if (rendererProtocolRegistered) {
    return;
  }
  protocol.handle(RENDERER_PROTOCOL, async (request) => {
    const filePath = rendererFileFromRequestUrl(request.url, productionRendererRoot);
    if (!filePath || !fs.existsSync(filePath)) {
      writeLogToFile("error", "Renderer asset missing", { url: request.url, filePath });
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const body = await fs.promises.readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": mimeTypeForRendererFile(filePath),
        "cache-control": "no-cache",
      },
    });
  });
  rendererProtocolRegistered = true;
}

function bindRendererDiagnostics(contents: WebContents) {
  contents.on("console-message", (event) => {
    const text = String(event.message || "");
    const lvl = String(event.level || "info");
    if (
      lvl !== "warning" &&
      lvl !== "error" &&
      !text.includes("[renderer-startup]") &&
      !text.toLowerCase().includes("content security policy")
    ) {
      return;
    }
    writeLogToFile(
      lvl === "error" ? "error" : lvl === "warning" ? "warn" : "info",
      `[renderer-console] ${text}`,
      {
        line: event.lineNumber,
        sourceId: event.sourceId,
      },
    );
  });
  contents.on("preload-error", (_event, preloadPath, error) => {
    writeLogToFile("fatal", "preload-error", { preloadPath, error: String(error) });
  });
}

async function createWindow() {
  logStartupStage("createWindow:start");
  const icon = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: BOOT_WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      // Dev loads electron/preload.js (plain CJS). Production build emits dist-electron/electron/preload.js from preload.ts.
      // Keep preload.js and preload.ts in sync — Electron does not hot-reload preload.
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
    closeBootSplash();
  });

  denyPopupWindows(mainWindow.webContents);
  bindRendererNavigationGuard(mainWindow.webContents);
  bindRendererDiagnostics(mainWindow.webContents);

  // ── Content Security Policy ──────────────────────────────────────────────
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' blob:; font-src 'self' data:; img-src 'self' data:; connect-src 'self';",
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
    const rendererPath = resolveProductionRendererHtml({
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
    });
    const rendererRoot = path.dirname(rendererPath);
    const rendererUrl = productionRendererUrl();
    registerProductionRendererProtocol(rendererRoot);
    logStartupStage("renderer:load-url", {
      rendererPath,
      rendererRoot,
      rendererUrl,
      exists: fs.existsSync(rendererPath),
    });
    mainWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        writeLogToFile("fatal", "Renderer failed to load", {
          errorCode,
          errorDescription,
          validatedURL,
          rendererPath,
          rendererUrl,
        });
        dialog.showErrorBox(
          "Display Error",
          `RestoNiti could not load its interface.\n\n${errorDescription} (${errorCode})\n${validatedURL}\n\nTry reinstalling the app or check logs in Settings.`,
        );
      },
    );
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      writeLogToFile("fatal", "Renderer process gone", details);
    });
    await mainWindow.loadURL(rendererUrl);
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
    openBootSplash(resolveAppIconPath());
    logStartupStage("db:init:start");
    await initializeDatabase();
    logStartupStage("db:init:done");
    logStartupStage("service:ensure-ready:start");
    posService.ensureReady();
    logStartupStage("service:ensure-ready:done");
    logStartupStage("ipc:register:start");
    registerPosIpc(() => mainWindow);
    configureDomainEvents(() => mainWindow);
    logStartupStage("ipc:register:done");

    // Show UI as soon as DB/IPC are ready; defer non-critical work so first paint is faster.
    const windowReady = createWindow();
    void windowReady.then(() => {
      logStartupStage("deferred:startup-services:start");
      try {
        updateService.processStartupState();
      } catch (error: any) {
        writeLogToFile("warn", `Update startup state failed: ${error?.stack || error}`);
      }
      try {
        bootstrapBackupManager((level, message, context) => writeLogToFile(level, message, context));
        startBackupScheduler({
          logger: (level, message, context) => writeLogToFile(level, `[backup] ${message}`, context),
        });
      } catch (error: any) {
        writeLogToFile("warn", `Backup bootstrap failed: ${error?.stack || error}`);
      }
      warmUpWindowsRawPrinter(app.getPath("userData"));
      logStartupStage("deferred:startup-services:done");
    });

    try {
      logStartupStage("gateway:start");
      await startLocalGateway();
      logStartupStage("gateway:ready", getGatewayStatus());
    } catch (gatewayError: any) {
      writeLogToFile(
        "error",
        `Local gateway failed to start: ${gatewayError?.stack || gatewayError}`,
      );
    }

    await windowReady;
    logStartupStage("createWindow:done");
  } catch (err: any) {
    closeBootSplash();
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
  closeBootSplash();
  stopBackupScheduler();
  destroyPdfExportWindow();
  shutdownWindowsRawPrinter();
  void stopLocalGateway();
  closeDb();
});

async function getPrinterConfig(): Promise<PrinterConfig> {
  try {
    const cfg = (posService.getSetting("config:printers") as any) || {};
    const kitchenFallback =
      process.env.KITCHEN_PRINTER_USB_NAME ||
      process.env.COUNTER_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    const counterFallback =
      process.env.COUNTER_PRINTER_USB_NAME ||
      process.env.KITCHEN_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    return {
      kitchenPrinterName: resolveKitchenPrinterTarget(cfg, kitchenFallback),
      counterPrinterName: resolveCounterPrinterTarget(cfg, counterFallback),
      printerPort: Number(cfg.printerPort || process.env.PRINTER_PORT || 9100),
    };
  } catch (e) {
    return {
      kitchenPrinterName: process.env.KITCHEN_PRINTER_USB_NAME || DEFAULT_USB_PRINTER_NAME,
      counterPrinterName:
        process.env.COUNTER_PRINTER_USB_NAME ||
        process.env.KITCHEN_PRINTER_USB_NAME ||
        DEFAULT_USB_PRINTER_NAME,
      printerPort: Number(process.env.PRINTER_PORT || 9100),
    };
  }
}

async function listAvailablePrinters(sender: WebContents): Promise<string[]> {
  const names = new Set<string>();
  try {
    for (const printer of await listWindowsPrinters()) {
      if (printer?.name) {
        names.add(printer.name);
      }
    }
  } catch (error) {
    console.warn("[PRINT] Windows printer list failed:", error);
  }
  try {
    const printers = await sender.getPrintersAsync();
    for (const printer of printers || []) {
      const name = String(printer?.name || printer?.displayName || "").trim();
      if (name && isSelectablePosPrinter(name)) {
        names.add(name);
      }
    }
  } catch (error) {
    console.warn("[PRINT] Electron printer list failed:", error);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

ipcMain.handle("printer:list", async (event, token: string | null) => {
  requireMainSession(event, token, ["admin"]);
  try {
    const printers = await listAvailablePrinters(event.sender);
    return { ok: true, printers };
  } catch (err: any) {
    return { ok: false, printers: [], error: err?.message || String(err) };
  }
});

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
ipcMain.handle(
  "log:write",
  async (_event, _token: string | null, level: string, message: string, context?: any) => {
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
  },
);

let pdfExportWindow: BrowserWindow | null = null;
let pdfExportChain: Promise<unknown> = Promise.resolve();

function getPdfExportWindow(): BrowserWindow {
  if (pdfExportWindow && !pdfExportWindow.isDestroyed()) {
    return pdfExportWindow;
  }
  pdfExportWindow = new BrowserWindow({
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
  denyPopupWindows(pdfExportWindow.webContents);
  bindRendererNavigationGuard(pdfExportWindow.webContents);
  return pdfExportWindow;
}

function destroyPdfExportWindow() {
  if (pdfExportWindow && !pdfExportWindow.isDestroyed()) {
    pdfExportWindow.destroy();
  }
  pdfExportWindow = null;
}

async function loadHtmlIntoPdfWindow(pdfWin: BrowserWindow, htmlFile: string) {
  await new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (_e: Electron.Event, code: number, desc: string) => {
      cleanup();
      reject(new Error(`Page load failed: ${desc} (${code})`));
    };
    const cleanup = () => {
      pdfWin.webContents.removeListener("did-finish-load", onLoad);
      pdfWin.webContents.removeListener("did-fail-load", onFail);
    };
    pdfWin.webContents.once("did-finish-load", onLoad);
    pdfWin.webContents.once("did-fail-load", onFail);
    void pdfWin.loadFile(htmlFile);
  });
}

// navigator.clipboard loses user activation after awaits in the renderer; write from main.
ipcMain.handle("clipboard:writeText", (event, token: string | null, text: string) => {
  requireMainSession(event, token);
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

// Report PDF export: render HTML to PDF via printToPDF and save via native save dialog
ipcMain.handle(
  "report:exportPdf",
  async (event, token: string | null, html: string, defaultFileName: string) => {
    requireMainSession(event, token, ["admin"]);
    const runExport = async () => {
      let tmpFile: string | null = null;
      try {
        const os = require("os");
        tmpFile = path.join(os.tmpdir(), `pos-report-${Date.now()}.html`);
        fs.writeFileSync(tmpFile, html, "utf-8");

        const pdfWin = getPdfExportWindow();
        await loadHtmlIntoPdfWindow(pdfWin, tmpFile);

        const pdfBuffer = await pdfWin.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
          // Electron 44+: PrintToPDFMargins is inch values only (no marginType).
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
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
        if (tmpFile) {
          try {
            fs.unlinkSync(tmpFile);
          } catch (_) {
            /* best-effort */
          }
        }
      }
    };

    const exportPromise = pdfExportChain.then(runExport, runExport);
    pdfExportChain = exportPromise.catch(() => undefined);
    return exportPromise;
  },
);
