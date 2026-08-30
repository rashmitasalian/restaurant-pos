#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");
const { createHash, scryptSync } = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const PERF_DB_PATH = path.join(ROOT_DIR, "data", "perf", "restaurant-pos-perf.sqlite");
const PERF_DIR = path.dirname(PERF_DB_PATH);
const PERF_USER_DATA_DIR = path.join(PERF_DIR, "electron-ui-user-data");
const PERF_ADMIN_USERNAME = "perfadmin";
const PERF_ADMIN_PASSWORD = "PerfAdmin123!";
const SCRYPT_ALGO = "SCRYPT-N131072-R8-P1";
const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 160 * 1024 * 1024,
};
const pdfExportMetrics = [];
const rendererMessages = [];

function parseArgs(argv) {
  const parsed = {
    iterations: 5,
    warmups: 1,
    output: null,
    rendererUrl: null,
    show: false,
    navCycles: 5,
    dayCycles: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined && rawKey !== "show") {
      index += 1;
    }

    if (rawKey === "iterations") {
      parsed.iterations = parsePositiveInt(value, "iterations");
    } else if (rawKey === "warmups") {
      parsed.warmups = parseNonNegativeInt(value, "warmups");
    } else if (rawKey === "output") {
      parsed.output = path.resolve(String(value || "").trim());
    } else if (rawKey === "renderer-url") {
      parsed.rendererUrl = String(value || "").trim();
    } else if (rawKey === "show") {
      parsed.show = true;
    } else if (rawKey === "nav-cycles") {
      parsed.navCycles = parsePositiveInt(value, "nav-cycles");
    } else if (rawKey === "day-cycles") {
      parsed.dayCycles = parseNonNegativeInt(value, "day-cycles");
    } else {
      throw new Error(`Unknown option: --${rawKey}`);
    }
  }

  return parsed;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer`);
  }
  return parsed;
}

function rerunWithElectron() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string") {
    throw new Error("Unable to locate Electron executable for UI performance script.");
  }
  const runnerFile = path.join(ROOT_DIR, "electron", ".perf-ui-runner.cjs");
  fs.writeFileSync(
    runnerFile,
    `global.__POS_PERF_ELECTRON__ = require("electron");\nrequire(${JSON.stringify(__filename)});\n`,
    "utf8",
  );

  const env = {
    ...process.env,
    NODE_ENV: "production",
    POS_PERF_ELECTRON_CHILD: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const result = spawnSync(electronPath, [runnerFile, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    env,
    encoding: "utf8",
  });
  try {
    fs.unlinkSync(runnerFile);
  } catch {}
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  const stderr = filterElectronStderr(result.stderr);
  if (stderr) {
    process.stderr.write(stderr);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status === null ? 1 : result.status);
}

function filterElectronStderr(value) {
  const lines = String(value || "").split(/\r?\n/);
  const kept = [];
  let suppressExpectedAuthStack = false;
  for (const line of lines) {
    if (!line) {
      suppressExpectedAuthStack = false;
      continue;
    }
    if (/Error occurred in handler for 'pos:settings:get': Error: auth-required/i.test(line)) {
      suppressExpectedAuthStack = true;
      continue;
    }
    if (suppressExpectedAuthStack && /^\s+at\s/.test(line)) {
      continue;
    }
    suppressExpectedAuthStack = false;
    if (/crashpad|CreateFile: Access is denied|GPU process/i.test(line)) {
      continue;
    }
    kept.push(`${line}\n`);
  }
  return kept.join("");
}

if (!process.versions.electron) {
  rerunWithElectron();
}

function registerTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = "1";
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: "CommonJS",
    moduleResolution: "Node",
  });
  require("ts-node/register/transpile-only");
}

function loadElectronModule() {
  if (global.__POS_PERF_ELECTRON__) {
    return global.__POS_PERF_ELECTRON__;
  }
  const electronRequire = createRequire(path.join(ROOT_DIR, "electron", "main-dev.cjs"));
  return electronRequire("electron");
}

function timestampForFileName() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatMb(valueKb) {
  return `${(Number(valueKb || 0) / 1024).toFixed(1)} MB`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function tabSelectedExpression(label) {
  return `Array.from(document.querySelectorAll('[role="tab"]')).some((tab) => (tab.innerText || tab.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase() === ${jsString(String(label).toLowerCase())} && tab.getAttribute("aria-selected") === "true")`;
}

function bodyIncludesExpression(text) {
  return `document.body.innerText.toLowerCase().includes(${jsString(String(text).toLowerCase())})`;
}

function pageHeadingExpression(text) {
  return `Array.from(document.querySelectorAll("#main-content h1, #main-content h2, main h1, main h2, .pos-ph-title, [class*='pageTitle'], [class*='title']")).some((element) => (element.textContent || "").trim().includes(${jsString(text)}))`;
}

function inputPlaceholderExpression(text) {
  return `Array.from(document.querySelectorAll("input")).some((input) => (input.placeholder || "").includes(${jsString(text)}))`;
}

function enabledButtonExpression(text, exact = false) {
  const operator = exact ? "===" : "includes";
  return `Array.from(document.querySelectorAll("button")).some((button) => {
    const label = (button.innerText || button.textContent || "").replace(/\\s+/g, " ").trim();
    const matches = ${operator === "===" ? `label === ${jsString(text)}` : `label.includes(${jsString(text)})`};
    return matches && !button.disabled && button.getAttribute("aria-disabled") !== "true";
  })`;
}

function clickEnabledButtonExpression(text, exact = false) {
  const operator = exact ? "===" : "includes";
  return `(() => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
      const label = (candidate.innerText || candidate.textContent || "").replace(/\\s+/g, " ").trim();
      const matches = ${operator === "===" ? `label === ${jsString(text)}` : `label.includes(${jsString(text)})`};
      return matches && !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true";
    });
    if (!button) {
      return false;
    }
    button.click();
    return true;
  })()`;
}

function createReportLogger() {
  const lines = [];
  return {
    line(value = "") {
      const text = String(value);
      lines.push(text);
      console.log(text);
    },
    writeToFile(outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const payload = `${lines.join("\n")}\n`;
      fs.writeFileSync(outputPath, payload, "utf8");
      fs.writeFileSync(path.join(PERF_DIR, "latest-ui-report.txt"), payload, "utf8");
      return outputPath;
    },
  };
}

function statsFor(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    avg: total / sorted.length,
    p95: sorted[p95Index],
    max: sorted[sorted.length - 1],
  };
}

async function runBenchmark({ run, iterations, warmups, rowCountFn }) {
  let latestResult;
  for (let index = 0; index < warmups; index += 1) {
    latestResult = await run();
  }

  const samples = [];
  const results = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    latestResult = await run();
    const elapsedMs = performance.now() - startedAt;
    samples.push(Number.isFinite(latestResult?.totalMs) ? latestResult.totalMs : elapsedMs);
    results.push(latestResult);
  }

  return {
    result: latestResult,
    results,
    stats: statsFor(samples),
    rows: rowCountFn ? rowCountFn(latestResult) : Number(latestResult?.rows || 0),
  };
}

const collectedRecords = [];

function writeJsonReport(outputPath, payload) {
  const jsonPath = outputPath.replace(/\.txt$/i, ".json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(PERF_DIR, "latest-ui-report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jsonPath;
}

function writeBenchmarkResult(report, name, result, targetMs, group = "UI") {
  const overTarget = result.stats.p95 > targetMs;
  report.line(name);
  report.line(`Avg: ${formatMs(result.stats.avg)}`);
  report.line(`P95: ${formatMs(result.stats.p95)}`);
  report.line(`Max: ${formatMs(result.stats.max)}`);
  report.line(`Rows: ${result.rows}`);
  report.line(
    overTarget
      ? `Guideline: REVIEW (P95 over ${formatMs(targetMs)})`
      : `Guideline: OK (P95 under ${formatMs(targetMs)})`,
  );
  collectedRecords.push({
    layer: "ui",
    group,
    name,
    avg: Number(result.stats.avg.toFixed(1)),
    p95: Number(result.stats.p95.toFixed(1)),
    max: Number(result.stats.max.toFixed(1)),
    rows: result.rows,
    targetMs,
    guideline: overTarget ? "REVIEW" : "OK",
  });
  return overTarget;
}

function writeMetricBreakdown(report, label, results, field) {
  const values = results
    .map((result) => Number(result?.[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return;
  }
  const stats = statsFor(values);
  report.line(`${label}: Avg ${formatMs(stats.avg)}, P95 ${formatMs(stats.p95)}, Max ${formatMs(stats.max)}`);
}

function writePdfBenchmarkResult(report, result, targetMs) {
  const overTarget = writeBenchmarkResult(report, "Report PDF Export Total", result, targetMs);
  const samples = result.results || [];
  if (samples.length) {
    const latest = result.result || samples[samples.length - 1];
    report.line("PDF Breakdown");
    writeMetricBreakdown(report, "Renderer HTML Handoff", samples, "handoffMs");
    writeMetricBreakdown(report, "Temp HTML Write", samples, "tempHtmlWriteMs");
    writeMetricBreakdown(report, "Electron HTML Load", samples, "loadHtmlMs");
    writeMetricBreakdown(report, "Electron printToPDF", samples, "printToPdfMs");
    writeMetricBreakdown(report, "PDF Handler Total", samples, "handlerTotalMs");
    report.line(`Latest HTML Size: ${formatBytes(latest?.htmlBytes)}`);
    report.line(`Latest PDF Size: ${formatBytes(latest?.pdfBytes)}`);
  }
  return overTarget;
}

function createDeterministicCredential(secret, seedText) {
  const salt = createHash("sha256").update(seedText).digest("hex").slice(0, 32);
  const hash = scryptSync(secret, Buffer.from(salt, "hex"), 64, SCRYPT_OPTIONS).toString("hex");
  return { salt, hash };
}

function ensurePerfAdmin(database) {
  const existing = database
    .prepare("SELECT username FROM users WHERE username = ?")
    .get(PERF_ADMIN_USERNAME);
  if (existing) {
    return;
  }
  const nowMs = Date.now();
  const credential = createDeterministicCredential(
    PERF_ADMIN_PASSWORD,
    `${PERF_ADMIN_USERNAME}:restaurant-pos-perf`,
  );
  database
    .prepare(
      `INSERT INTO users (
        username, display_name, role, password_hash, salt, hash_algo, active,
        require_password_change, created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(
      PERF_ADMIN_USERNAME,
      "Perf Admin",
      credential.hash,
      credential.salt,
      SCRYPT_ALGO,
      nowMs,
      nowMs,
    );
}

function getRendererSource(rendererUrl) {
  if (rendererUrl) {
    return { type: "url", value: rendererUrl };
  }
  const rendererPath = path.join(ROOT_DIR, "dist", "index.html");
  if (!fs.existsSync(rendererPath)) {
    throw new Error(
      "Built renderer not found at dist/index.html. Run npm run build:renderer first, or pass --renderer-url http://localhost:5173.",
    );
  }
  return { type: "file", value: rendererPath };
}

async function evalInWindow(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

async function waitForCondition(win, expression, timeoutMs = 10000) {
  const startedAt = performance.now();
  let lastError = null;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const ok = await evalInWindow(
        win,
        `Boolean((() => { try { return (${expression}); } catch (error) { return false; } })())`,
      );
      if (ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  let bodyExcerpt = "";
  try {
    bodyExcerpt = await evalInWindow(
      win,
      `String(document.body?.innerText || document.documentElement?.innerText || "").slice(0, 500)`,
    );
  } catch {}
  throw new Error(
    `Timed out waiting for renderer condition: ${expression}${lastError ? ` (${lastError.message})` : ""}${
      bodyExcerpt ? ` | Body: ${bodyExcerpt}` : ""
    }${rendererMessages.length ? ` | Renderer: ${rendererMessages.slice(-5).join(" | ")}` : ""}`,
  );
}

async function waitForText(win, text, timeoutMs = 10000) {
  await waitForCondition(
    win,
    `document.body && document.body.innerText.includes(${JSON.stringify(text)})`,
    timeoutMs,
  );
}

async function clickEnabledButton(win, text, options = {}) {
  const exact = Boolean(options.exact);
  await waitForCondition(win, enabledButtonExpression(text, exact), options.timeoutMs || 10000);
  const clicked = await evalInWindow(win, clickEnabledButtonExpression(text, exact));
  if (!clicked) {
    throw new Error(`Button was not clickable: ${text}`);
  }
}

async function waitForPaint(win) {
  await evalInWindow(
    win,
    `new Promise((resolve) => setTimeout(resolve, 50))`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMainWindow({ BrowserWindow, session }, rendererSource, show) {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    show,
    webPreferences: {
      preload: path.join(ROOT_DIR, "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  win.webContents.on("console-message", (event) => {
    const message = event?.message || "";
    const sourceId = event?.sourceId || "";
    const line = event?.lineNumber || "";
    if (/Electron Security Warning|Insecure Content-Security-Policy|unsafe-eval|electronjs\.org\/docs\/tutorial\/security/i.test(message)) {
      return;
    }
    if (message) {
      rendererMessages.push(`${message}${sourceId ? ` (${sourceId}:${line})` : ""}`);
    }
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    rendererMessages.push(`did-fail-load ${code}: ${description} ${url || ""}`.trim());
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    rendererMessages.push(`render-process-gone: ${details?.reason || "unknown"}`);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (rendererSource.type === "url") {
    await win.loadURL(rendererSource.value);
  } else {
    await win.loadFile(rendererSource.value);
  }
  return win;
}

async function performLogin(win) {
  await waitForCondition(
    win,
    `document.querySelector("#app-root") || document.querySelector('input[type="password"]')`,
    15000,
  );
  const alreadyLoggedIn = await evalInWindow(win, `Boolean(document.querySelector("#app-root"))`);
  if (alreadyLoggedIn) {
    return { rows: 1 };
  }

  await waitForCondition(win, `document.querySelector('input[type="password"]')`, 10000);
  const loginSubmitted = await evalInWindow(
    win,
    `
      (() => {
        const setNativeValue = (element, value) => {
          if (!element) {
            return false;
          }
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
          setter.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };
        const inputs = Array.from(document.querySelectorAll("input"));
        const username = inputs.find((input) => input.autocomplete === "username") ||
          inputs.find((input) => input.type === "text") ||
          inputs[0];
        const password = inputs.find((input) => input.autocomplete === "current-password") ||
          inputs.find((input) => input.type === "password");
        const submit = document.querySelector('button[type="submit"]');
        if (!setNativeValue(username, ${JSON.stringify(PERF_ADMIN_USERNAME)}) ||
          !setNativeValue(password, ${JSON.stringify(PERF_ADMIN_PASSWORD)}) ||
          !submit ||
          submit.disabled ||
          submit.getAttribute("aria-disabled") === "true") {
          return false;
        }
        submit.click();
        return true;
      })()
    `,
  );
  if (!loginSubmitted) {
    throw new Error("Login form was not ready for submission.");
  }
  await waitForCondition(win, `document.querySelector("#app-root")`, 15000);
  await waitForText(win, "Tables", 15000);
  await waitForPaint(win);
  return { rows: 1 };
}

const PAGES = [
  {
    name: "Tables",
    hash: "#tables",
    ready: `${pageHeadingExpression("Tables")} && document.querySelector('[aria-label^="Table "]')`,
    rows: `document.querySelectorAll('[aria-label^="Table "]').length`,
    targetMs: 1000,
  },
  {
    name: "Billing",
    hash: "#billing",
    ready: `document.querySelector("#main-content") && (document.body.innerText.includes("No active order") || ${enabledButtonExpression("Settle", true)} || ${inputPlaceholderExpression("Search item by name")})`,
    rows: `document.querySelectorAll("button").length`,
    targetMs: 1000,
  },
  {
    name: "KOT Queue",
    hash: "#kot",
    ready: pageHeadingExpression("KOT Queue"),
    rows: `document.querySelectorAll("button").length`,
    targetMs: 1000,
  },
  {
    name: "Customers",
    hash: "#customers",
    ready: `${pageHeadingExpression("Customers")} && ${inputPlaceholderExpression("Customer name")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1000,
  },
  {
    name: "Overview",
    hash: "#manage-overview",
    ready: `${pageHeadingExpression("Overview")} && (document.body.innerText.toLowerCase().includes("procurement") || document.body.innerText.includes("Buying List") || document.body.innerText.includes("needs attention"))`,
    rows: `document.querySelectorAll("li").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Grocery Buying Lists",
    hash: "#manage-grocery-lists",
    ready: `${pageHeadingExpression("Grocery")} && ${inputPlaceholderExpression("Search lists")}`,
    rows: `document.querySelectorAll("article, li, tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Grocery Purchases",
    hash: "#manage-grocery-purchases",
    ready: `${pageHeadingExpression("Grocery")} && (document.body.innerText.includes("Purchases") || document.body.innerText.includes("No purchases"))`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Grocery Vendors",
    hash: "#manage-grocery-vendors",
    ready: `${pageHeadingExpression("Grocery")} && ${inputPlaceholderExpression("Search vendors")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1000,
  },
  {
    name: "Grocery Items",
    hash: "#manage-grocery-items",
    ready: `${pageHeadingExpression("Grocery")} && ${inputPlaceholderExpression("Search items")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Expenses",
    hash: "#manage-expenses",
    ready: `${pageHeadingExpression("Expenses")} && ${enabledButtonExpression("Add Expense")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Menu",
    hash: "#manage-menu",
    ready: `${pageHeadingExpression("Menu")} && ${inputPlaceholderExpression("Search by name")}`,
    rows: `document.querySelectorAll("tbody tr").length || Array.from(document.querySelectorAll("button")).filter((button) => button.innerText.includes("Item")).length`,
    targetMs: 1500,
  },
  {
    name: "Attendance",
    hash: "#manage-people-attendance",
    ready: `${pageHeadingExpression("Attendance")} && ${inputPlaceholderExpression("Search employee")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Roster",
    hash: "#manage-people-roster",
    ready: `${pageHeadingExpression("Roster")} && ${inputPlaceholderExpression("Search by name")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Salary Advances",
    hash: "#manage-people-advances",
    ready: `${pageHeadingExpression("Salary Advances")} && (${enabledButtonExpression("Record Advance")} || document.body.innerText.includes("salary advance"))`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
  {
    name: "Accounts",
    hash: "#manage-people-accounts",
    ready: `${pageHeadingExpression("Accounts")} && ${enabledButtonExpression("Add User")}`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`,
    targetMs: 1000,
  },
  {
    name: "Reports",
    hash: "#reports",
    ready: `${pageHeadingExpression("Reports")} && (${bodyIncludesExpression("Sales and profitability")} || ${bodyIncludesExpression("Total Sales")} || ${bodyIncludesExpression("Export PDF")} || ${bodyIncludesExpression("Food Cost")})`,
    rows: `document.querySelectorAll("tbody tr").length || document.querySelectorAll("svg path").length`,
    targetMs: 1500,
  },
  {
    name: "Order History",
    hash: "#manage-history",
    ready: `${pageHeadingExpression("Order History")} && ${inputPlaceholderExpression("Search order")}`,
    rows: `Array.from(document.querySelectorAll("button")).filter((button) => (button.innerText || "").includes("Preview")).length`,
    targetMs: 1500,
  },
  {
    name: "Audit",
    hash: "#manage-audit",
    ready: `${pageHeadingExpression("Audit Log")} && ${inputPlaceholderExpression("Filter by action")}`,
    rows: `document.body.innerText.match(/Page \\d+ of \\d+ . (\\d+) records/) ? Number(document.body.innerText.match(/Page \\d+ of \\d+ . (\\d+) records/)[1]) : document.querySelectorAll("tbody tr").length`,
    targetMs: 1500,
  },
  {
    name: "Settings",
    hash: "#manage-settings",
    ready: `${pageHeadingExpression("Settings")} && (${inputPlaceholderExpression("Restaurant name")} || ${inputPlaceholderExpression("Current admin password")})`,
    rows: `document.querySelectorAll("button").length`,
    targetMs: 1500,
  },
];

const TAB_TESTS = [
  {
    name: "Reports Profitability Tab",
    parent: "Reports",
    tabLabel: "Profitability",
    ready: `${tabSelectedExpression("Profitability")} && (${bodyIncludesExpression("operating expenses")} || ${bodyIncludesExpression("estimated operating profit")} || ${bodyIncludesExpression("food cost")})`,
    targetMs: 1500,
  },
  {
    name: "Attendance History Tab",
    parent: "Attendance",
    tabLabel: "History",
    ready: `${tabSelectedExpression("History")} && ${bodyIncludesExpression("Attendance History")}`,
    targetMs: 1500,
  },
  {
    name: "Salary Advances Transactions Tab",
    parent: "Salary Advances",
    tabLabel: "Transactions",
    ready: `${tabSelectedExpression("Transactions")} && (${bodyIncludesExpression("No salary advance transactions")} || ${bodyIncludesExpression("Individual advance records")} || Array.from(document.querySelectorAll("th")).some((cell) => (cell.textContent || "").toLowerCase().includes("date")))`,
    targetMs: 1200,
  },
  {
    name: "Settings Hardware Tab",
    parent: "Settings",
    tabLabel: "Hardware",
    ready: `${tabSelectedExpression("Hardware")} && document.querySelector('[data-settings-focus="hardware"]')`,
    targetMs: 800,
  },
  {
    name: "Settings Operations Tab",
    parent: "Settings",
    tabLabel: "Operations",
    ready: `${tabSelectedExpression("Operations")} && document.querySelector('[data-settings-focus="operations"]')`,
    targetMs: 800,
  },
  {
    name: "Settings Retention Tab",
    parent: "Settings",
    tabLabel: "Retention",
    ready: `${tabSelectedExpression("Retention")} && document.querySelector('[data-settings-focus="retention"]')`,
    targetMs: 800,
  },
];

async function navigateToPage(win, page) {
  await evalInWindow(win, `window.location.hash = ${JSON.stringify(page.hash)}`);
  if (page.hash === "#manage-settings") {
    await waitForCondition(win, pageHeadingExpression("Settings"), 15000);
    await clickRoleTab(win, "Identity");
  }
  await waitForCondition(win, page.ready, 15000);
  await waitForPaint(win);
  const rows = await evalInWindow(win, `Number((() => { try { return ${page.rows}; } catch { return 0; } })())`);
  return { rows };
}

async function clickRoleTab(win, label) {
  await waitForCondition(
    win,
    `Array.from(document.querySelectorAll('[role="tab"]')).some((tab) => (tab.innerText || tab.textContent || "").replace(/\\s+/g, " ").trim() === ${jsString(label)})`,
    10000,
  );
  const clicked = await evalInWindow(
    win,
    `(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((candidate) =>
        (candidate.innerText || candidate.textContent || "").replace(/\\s+/g, " ").trim() === ${jsString(label)}
      );
      if (!tab) {
        return false;
      }
      tab.click();
      return true;
    })()`,
  );
  if (!clicked) {
    throw new Error(`Tab was not clickable: ${label}`);
  }
}

async function measureTab(win, test) {
  const parent = PAGES.find((page) => page.name === test.parent);
  if (!parent) {
    throw new Error(`Unknown parent page for tab: ${test.name}`);
  }
  await navigateToPage(win, parent);
  const startedAt = performance.now();
  await clickRoleTab(win, test.tabLabel);
  await waitForCondition(win, test.ready, 15000);
  await waitForPaint(win);
  const rows = await evalInWindow(win, `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`);
  return { rows, totalMs: performance.now() - startedAt };
}

const SEARCH_TESTS = [
  { name: "Tables Search", hash: "#tables", placeholder: "Search table", query: "1", targetMs: 200 },
  { name: "Menu Search", hash: "#manage-menu", placeholder: "Search by name", query: "Item 0", targetMs: 250 },
  { name: "Reports Item Search", hash: "#reports", placeholder: "Search item", query: "Item", targetMs: 250 },
  { name: "History Search", hash: "#manage-history", placeholder: "Search order", query: "cash", clickSearch: true, targetMs: 500 },
  { name: "Audit Search", hash: "#manage-audit", placeholder: "Filter by action", query: "order", targetMs: 800 },
  { name: "Attendance Search", hash: "#manage-people-attendance", placeholder: "Search employee", query: "Staff", targetMs: 300 },
  { name: "Roster Search", hash: "#manage-people-roster", placeholder: "Search by name", query: "Staff 00", targetMs: 300 },
  { name: "Grocery Lists Search", hash: "#manage-grocery-lists", placeholder: "Search lists", query: "Buying", targetMs: 300 },
  { name: "Grocery Items Search", hash: "#manage-grocery-items", placeholder: "Search items", query: "Grocery", targetMs: 400 },
  { name: "Vendors Search", hash: "#manage-grocery-vendors", placeholder: "Search vendors", query: "Vendor", targetMs: 250 },
];

async function measureSearch(win, test) {
  const page = PAGES.find((candidate) => candidate.hash === test.hash);
  if (page) {
    await navigateToPage(win, page);
  }
  await waitForCondition(
    win,
    `Array.from(document.querySelectorAll("input")).some((input) => (input.placeholder || "").includes(${JSON.stringify(test.placeholder)}))`,
    10000,
  );
  const searchApplied = await evalInWindow(
    win,
    `
      (() => {
        const setNativeValue = (element, value) => {
          if (!element) {
            return false;
          }
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
          setter.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };
        const input = Array.from(document.querySelectorAll("input")).find((candidate) =>
          (candidate.placeholder || "").includes(${JSON.stringify(test.placeholder)})
        );
        if (!setNativeValue(input, ${JSON.stringify(test.query)})) {
          return false;
        }
        if (${test.clickSearch ? "true" : "false"}) {
          const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
            candidate.innerText.trim() === "Search" &&
            !candidate.disabled &&
            candidate.getAttribute("aria-disabled") !== "true"
          );
          if (!button) {
            return false;
          }
          button.click();
        }
        return true;
      })()
    `,
  );
  if (!searchApplied) {
    throw new Error(`Search control was not ready: ${test.name}`);
  }
  await waitForCondition(
    win,
    `Array.from(document.querySelectorAll("input")).some((input) => (input.placeholder || "").includes(${JSON.stringify(test.placeholder)}) && input.value === ${JSON.stringify(test.query)})`,
    5000,
  );
  await waitForPaint(win);
  const rows = await evalInWindow(win, `document.querySelectorAll("tbody tr").length || document.querySelectorAll("button").length`);
  return { rows };
}

async function runInRolledBackSavepointAsync(database, name, fn) {
  database.exec(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    database.exec(`ROLLBACK TO ${name}`);
    database.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try {
      database.exec(`ROLLBACK TO ${name}`);
      database.exec(`RELEASE ${name}`);
    } catch {}
    throw error;
  }
}

async function runBillingUiWorkflow(win, database) {
  return runInRolledBackSavepointAsync(database, "perf_ui_billing", async () => {
    const tablesPage = PAGES.find((page) => page.name === "Tables");
    await navigateToPage(win, tablesPage);
    const tableClicked = await evalInWindow(
      win,
      `
        (() => {
          const table = Array.from(document.querySelectorAll('[aria-label^="Table "]'))
            .find((candidate) => candidate.getAttribute("aria-label").startsWith("Table 1,"));
          if (!table) {
            return false;
          }
          table.click();
          return true;
        })()
      `,
    );
    if (!tableClicked) {
      throw new Error("Table 1 was not clickable.");
    }
    await waitForCondition(
      win,
      `document.body.innerText.includes("Table 1") || window.location.hash === "#billing"`,
      15000,
    );
    await waitForCondition(
      win,
      `Array.from(document.querySelectorAll("button")).some((button) => button.innerText.includes("Item 001"))`,
      15000,
    );
    for (const itemName of ["Item 001", "Item 002", "Item 003"]) {
      await clickEnabledButton(win, itemName, { timeoutMs: 10000 });
    }
    await waitForCondition(
      win,
      `document.body.innerText.includes("3 items") || document.body.innerText.includes("3 item")`,
      10000,
    );
    await clickEnabledButton(win, "Settle", { exact: true, timeoutMs: 10000 });
    await waitForCondition(
      win,
      `document.body.innerText.includes("Amount Due") || document.querySelector('[aria-label="Collect Payment"]')`,
      10000,
    );
    await clickEnabledButton(win, "Cash", { timeoutMs: 10000 });
    await waitForCondition(
      win,
      `!document.querySelector('[aria-label="Collect Payment"]') && document.body.innerText.includes("No active order")`,
      15000,
    );
    await waitForPaint(win);
    return { rows: 1 };
  });
}

async function runPdfExport(win) {
  const reportsPage = PAGES.find((page) => page.name === "Reports");
  await navigateToPage(win, reportsPage);
  await clickRoleTab(win, "Sales");
  await waitForCondition(win, enabledButtonExpression("Export PDF"), 10000);
  const beforeCount = pdfExportMetrics.length;
  const startedAt = performance.now();
  const clicked = await evalInWindow(win, clickEnabledButtonExpression("Export PDF"));
  if (!clicked) {
    throw new Error("Report PDF export button was not clickable.");
  }
  while (pdfExportMetrics.length <= beforeCount && performance.now() - startedAt < 30000) {
    await sleep(50);
  }
  if (pdfExportMetrics.length <= beforeCount) {
    throw new Error("Timed out waiting for PDF export handler.");
  }
  const completedAt = performance.now();
  const latestMetric = pdfExportMetrics[pdfExportMetrics.length - 1];
  await waitForPaint(win);
  return {
    rows: 1,
    ...latestMetric,
    handoffMs: Math.max(0, Number(latestMetric.handlerStartedAt || startedAt) - startedAt),
    totalMs: completedAt - startedAt,
  };
}

async function runAuditCsvExport(win, electronSession) {
  const auditPage = PAGES.find((page) => page.name === "Audit");
  await navigateToPage(win, auditPage);
  let downloadSeen = false;
  const downloadPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    electronSession.defaultSession.once("will-download", (event, item) => {
      downloadSeen = true;
      event.preventDefault();
      try {
        item.cancel();
      } catch {}
      clearTimeout(timer);
      resolve(true);
    });
  });
  await clickEnabledButton(win, "Export Page CSV", { timeoutMs: 10000 });
  const downloadStarted = await downloadPromise;
  if (!downloadStarted) {
    throw new Error("Timed out waiting for Audit CSV download.");
  }
  await waitForPaint(win);
  return { rows: downloadSeen ? 1 : 0 };
}

async function runRepeatedNavigation(win, cycles, takeMemory = null) {
  const pages = [
    "Reports",
    "Order History",
    "Audit",
    "Menu",
    "Tables",
    "Grocery Buying Lists",
    "Expenses",
    "Attendance",
  ]
    .map((name) => PAGES.find((page) => page.name === name))
    .filter(Boolean);
  const memorySamples = [];
  const pageMemorySummary = new Map();
  const sampleCycles = new Set(
    [0, Math.floor((cycles - 1) / 2), cycles - 1].filter((cycle) => cycle >= 0 && cycle < cycles),
  );
  let rows = 0;
  let navigationMs = 0;
  let previousMemory = null;
  if (takeMemory) {
    previousMemory = await takeMemory("Memory Before Repeated Navigation");
    memorySamples.push(previousMemory);
  }
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const page of pages) {
      const navigationStartedAt = performance.now();
      const result = await navigateToPage(win, page);
      navigationMs += performance.now() - navigationStartedAt;
      rows += Number(result.rows || 0);
      if (takeMemory) {
        const currentMemory = await takeMemory(`Memory Repeated Navigation Cycle ${cycle + 1} After ${page.name}`);
        addPageMemoryDelta(pageMemorySummary, page.name, currentMemory, previousMemory);
        previousMemory = currentMemory;
        if (sampleCycles.has(cycle)) {
          memorySamples.push(currentMemory);
        }
      }
    }
  }
  return {
    rows,
    totalMs: navigationMs,
    memorySamples,
    pageMemorySummary: Array.from(pageMemorySummary.values()),
  };
}

function addPageMemoryDelta(summary, pageName, current, previous) {
  if (!current || !previous) {
    return;
  }
  const entry =
    summary.get(pageName) ||
    {
      pageName,
      samples: 0,
      totalDeltaKb: 0,
      rendererDeltaKb: 0,
      mainDeltaKb: 0,
      positiveRendererDeltaKb: 0,
      maxRendererDeltaKb: Number.NEGATIVE_INFINITY,
    };
  const totalDeltaKb = current.totalWorkingSetKb - previous.totalWorkingSetKb;
  const rendererDeltaKb = current.rendererWorkingSetKb - previous.rendererWorkingSetKb;
  const mainDeltaKb = current.mainPrivateKb - previous.mainPrivateKb;
  entry.samples += 1;
  entry.totalDeltaKb += totalDeltaKb;
  entry.rendererDeltaKb += rendererDeltaKb;
  entry.mainDeltaKb += mainDeltaKb;
  entry.positiveRendererDeltaKb += Math.max(0, rendererDeltaKb);
  entry.maxRendererDeltaKb = Math.max(entry.maxRendererDeltaKb, rendererDeltaKb);
  summary.set(pageName, entry);
}

function createDaySimulation(posService, database, cycles) {
  const items = posService.getItems().slice(0, 5);
  if (!items.length || cycles <= 0) {
    return () => ({ rows: 0 });
  }
  return () =>
    runInRolledBackSavepointSync(database, "perf_ui_day_simulation", () => {
      for (let index = 0; index < cycles; index += 1) {
        let order = posService.createOrder({
          orderType: index % 3 === 0 ? "takeaway" : "table",
          tableId: index % 3 === 0 ? null : ((index % 24) + 1),
          createdBy: null,
          meta: { perfUiDaySimulation: true, index },
        });
        const lineCount = 1 + (index % 3);
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
          const item = items[(index + lineIndex) % items.length];
          order = posService.addItemToOrder(order._id, {
            name: item.name,
            qty: 1 + (lineIndex % 2),
            rate: item.price,
            menuItemId: item._id,
            categoryName: item.category || null,
          });
        }
        posService.setOrderPaid(order._id, {
          method: index % 2 === 0 ? "cash" : "upi",
          amount: order.total,
          amountPaid: order.total,
          receivedBy: null,
        });
        if (index % 5 === 0) {
          posService.getSalesSummary({});
          posService.getAudits({ limit: 25, offset: 0 });
        }
      }
      return { rows: cycles };
    });
}

function runInRolledBackSavepointSync(database, name, fn) {
  database.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    database.exec(`ROLLBACK TO ${name}`);
    database.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try {
      database.exec(`ROLLBACK TO ${name}`);
      database.exec(`RELEASE ${name}`);
    } catch {}
    throw error;
  }
}

async function memorySnapshot(app, label) {
  const metrics = app.getAppMetrics();
  const totalWorkingSetKb = metrics.reduce(
    (sum, metric) => sum + Number(metric?.memory?.workingSetSize || 0),
    0,
  );
  const rendererWorkingSetKb = metrics
    .filter((metric) => /renderer|tab/i.test(String(metric.type || "")))
    .reduce((sum, metric) => sum + Number(metric?.memory?.workingSetSize || 0), 0);
  let mainPrivateKb = 0;
  try {
    const info = await process.getProcessMemoryInfo();
    mainPrivateKb = Number(info.private || 0);
  } catch {}
  return {
    label,
    totalWorkingSetKb,
    rendererWorkingSetKb,
    mainPrivateKb,
    processCount: metrics.length,
  };
}

function printMemory(report, snapshot) {
  report.line(`${snapshot.label}`);
  report.line(`Total Working Set: ${formatMb(snapshot.totalWorkingSetKb)}`);
  report.line(`Renderer Working Set: ${formatMb(snapshot.rendererWorkingSetKb)}`);
  report.line(`Main Private: ${formatMb(snapshot.mainPrivateKb)}`);
  report.line(`Processes: ${snapshot.processCount}`);
}

function printMemoryDelta(report, current, previous) {
  report.line(
    `Delta Since Previous: Total ${formatMb(current.totalWorkingSetKb - previous.totalWorkingSetKb)} | Renderer ${formatMb(
      current.rendererWorkingSetKb - previous.rendererWorkingSetKb,
    )} | Main ${formatMb(current.mainPrivateKb - previous.mainPrivateKb)}`,
  );
}

function printMemorySeries(report, snapshots) {
  let previous = null;
  for (const snapshot of snapshots) {
    printMemory(report, snapshot);
    if (previous) {
      printMemoryDelta(report, snapshot, previous);
    }
    report.line("");
    previous = snapshot;
  }
}

function printRepeatedNavigationMemorySummary(report, summary) {
  const rows = [...summary].sort(
    (a, b) => Number(b.positiveRendererDeltaKb || 0) - Number(a.positiveRendererDeltaKb || 0),
  );
  if (!rows.length) {
    return;
  }
  report.line("=== Repeated Navigation Memory Summary ===");
  report.line("Sorted by positive renderer growth.");
  for (const row of rows) {
    report.line(
      `${row.pageName}: Samples ${row.samples} | Renderer Net ${formatMb(row.rendererDeltaKb)} | Renderer Positive ${formatMb(
        row.positiveRendererDeltaKb,
      )} | Max Renderer Step ${formatMb(row.maxRendererDeltaKb)} | Total Net ${formatMb(row.totalDeltaKb)} | Main Net ${formatMb(
        row.mainDeltaKb,
      )}`,
    );
  }
  report.line("");
}

async function runFullAppWalk(win) {
  const startedAt = performance.now();
  let rows = 0;
  for (const page of PAGES) {
    const result = await navigateToPage(win, page);
    rows += Number(result.rows || 0);
  }
  for (const test of TAB_TESTS) {
    const result = await measureTab(win, test);
    rows += Number(result.rows || 0);
  }
  return { rows, totalMs: performance.now() - startedAt };
}

function getPaymentBounds(database) {
  return database
    .prepare(
      "SELECT MIN(received_at) AS minReceivedAt, MAX(received_at) AS maxReceivedAt FROM payments WHERE status = 'completed'",
    )
    .get();
}

let perfPdfExportWindow = null;

function getPerfPdfExportWindow(BrowserWindow) {
  if (perfPdfExportWindow && !perfPdfExportWindow.isDestroyed()) {
    return perfPdfExportWindow;
  }
  perfPdfExportWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  return perfPdfExportWindow;
}

function registerPerfIpcHandlers({ BrowserWindow, ipcMain }, mainWindow) {
  ipcMain.handle("printer:print", async () => ({
    ok: true,
    transport: "perf-stub",
  }));
  ipcMain.handle("log:write", async () => ({ ok: true }));
  ipcMain.handle("report:exportPdf", async (_event, _token, html, defaultFileName) => {
    const handlerStartedAt = performance.now();
    let tmpFile = null;
    try {
      const htmlText = String(html || "");
      const htmlBytes = Buffer.byteLength(htmlText, "utf8");
      tmpFile = path.join(PERF_DIR, `ui-pdf-${Date.now()}-${safeFilePart(defaultFileName)}.html`);
      const writeStartedAt = performance.now();
      fs.writeFileSync(tmpFile, htmlText, "utf8");
      const tempHtmlWriteMs = performance.now() - writeStartedAt;
      const pdfWin = getPerfPdfExportWindow(BrowserWindow);
      const loadStartedAt = performance.now();
      await pdfWin.loadFile(tmpFile);
      const loadHtmlMs = performance.now() - loadStartedAt;
      const printStartedAt = performance.now();
      const pdfBuffer = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });
      const printToPdfMs = performance.now() - printStartedAt;
      const pdfBytes = pdfBuffer.length;
      const metrics = {
        handlerStartedAt,
        htmlBytes,
        pdfBytes,
        tempHtmlWriteMs,
        loadHtmlMs,
        printToPdfMs,
        handlerTotalMs: performance.now() - handlerStartedAt,
      };
      pdfExportMetrics.push(metrics);
      return { ok: true, path: path.join(PERF_DIR, "discarded-perf-export.pdf"), bytes: pdfBytes, metrics };
    } finally {
      if (tmpFile) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {}
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      }
    }
  });
}

function safeFilePart(value) {
  return String(value || "report")
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 40)
    .toLowerCase();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(PERF_DB_PATH)) {
    throw new Error(`Performance database not found: ${PERF_DB_PATH}. Run npm run perf:seed first.`);
  }

  const originalConsoleError = console.error;
  console.error = (...args) => {
    const text = args
      .map((arg) => (arg instanceof Error ? arg.stack || arg.message : String(arg)))
      .join(" ");
    if (text.includes("pos:settings:get") && text.includes("auth-required")) {
      return;
    }
    originalConsoleError(...args);
  };

  const electron = loadElectronModule();
  if (!electron?.app) {
    throw new Error(`Electron main-process module is unavailable (${typeof electron}).`);
  }
  const { app, ipcMain, session } = electron;
  const rendererSource = getRendererSource(opts.rendererUrl);
  const outputPath = opts.output || path.join(PERF_DIR, `ui-report-${timestampForFileName()}.txt`);
  const report = createReportLogger();
  let mainWindow = null;
  let closeDb = null;

  try {
    fs.mkdirSync(PERF_USER_DATA_DIR, { recursive: true });
    process.env.POS_DB_PATH_OVERRIDE = PERF_DB_PATH;
    process.env.NODE_ENV = "production";
    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-gpu");
    app.setPath("userData", PERF_USER_DATA_DIR);

    registerTsNode();
    const sqlite = require(path.join(ROOT_DIR, "electron", "db", "sqlite"));
    const { posService } = require(path.join(ROOT_DIR, "electron", "services", "posService"));
    const { registerPosIpc } = require(path.join(ROOT_DIR, "electron", "ipc", "posIpc"));
    closeDb = sqlite.closeDb;

    const appStart = performance.now();
    await app.whenReady();
    await session.defaultSession.clearStorageData();

    const dbStart = performance.now();
    await sqlite.initializeDatabase();
    const dbReadyMs = performance.now() - dbStart;
    const database = sqlite.getDb();
    ensurePerfAdmin(database);
    posService.ensureReady();
    const bounds = getPaymentBounds(database);

    registerPosIpc(() => mainWindow);

    report.line(`UI performance database: ${PERF_DB_PATH}`);
    report.line(`Renderer: ${rendererSource.type === "url" ? rendererSource.value : path.relative(ROOT_DIR, rendererSource.value)}`);
    report.line(`Iterations: ${opts.iterations}`);
    report.line(`Warmups: ${opts.warmups}`);
    report.line("Targets are guidelines, not build blockers.");
    if (bounds?.maxReceivedAt) {
      const latestSaleDate = new Date(Number(bounds.maxReceivedAt)).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (latestSaleDate !== today) {
        report.line(
          `Note: latest seeded sale is ${latestSaleDate}, while today is ${today}. Today-based UI pages may be lighter unless you seed with --anchor ${today}.`,
        );
      }
    }
    report.line("");

    registerPerfIpcHandlers(electron, mainWindow);

    collectedRecords.length = 0;
    const loadStart = performance.now();
    mainWindow = await createMainWindow(electron, rendererSource, opts.show);
    const rendererLoadMs = performance.now() - loadStart;
    await waitForCondition(
      mainWindow,
      `document.querySelector('input[type="password"]') && document.body.innerText.includes("Sign in")`,
      15000,
    );
    await waitForPaint(mainWindow);
    const loginPageMs = performance.now() - loadStart;
    const firstScreenMs = performance.now() - appStart;

    report.line("=== Startup ===");
    report.line(`DB Initialization: ${formatMs(dbReadyMs)}`);
    report.line(`Renderer Load: ${formatMs(rendererLoadMs)}`);
    report.line(`Login Page Ready: ${formatMs(loginPageMs)}`);
    report.line(`First Screen Ready: ${formatMs(firstScreenMs)}`);
    report.line("");
    writeBenchmarkResult(
      report,
      "Login Page Ready",
      { stats: { avg: loginPageMs, p95: loginPageMs, max: loginPageMs }, rows: 1 },
      1500,
      "Auth",
    );
    report.line("");

    const loginResult = await runBenchmark({
      run: () => performLogin(mainWindow),
      iterations: 1,
      warmups: 0,
    });
    writeBenchmarkResult(report, "Login Submit", loginResult, 1500, "Auth");
    report.line("");

    const memoryCheckpoints = [];
    const takeMemory = (label) => memorySnapshot(app, label);
    const captureMemory = async (label) => {
      const snapshot = await takeMemory(label);
      memoryCheckpoints.push(snapshot);
      return snapshot;
    };

    await captureMemory("Memory After Login");

    report.line("=== Page Navigation ===");
    let reviewCount = collectedRecords.filter((row) => row.guideline === "REVIEW").length;
    for (const page of PAGES) {
      const result = await runBenchmark({
        run: () => navigateToPage(mainWindow, page),
        iterations: opts.iterations,
        warmups: opts.warmups,
      });
      if (writeBenchmarkResult(report, `Open ${page.name}`, result, page.targetMs, "Pages")) {
        reviewCount += 1;
      }
      report.line("");
    }
    await captureMemory("Memory After Page Navigation");

    report.line("=== In-Page Tabs ===");
    for (const test of TAB_TESTS) {
      const result = await runBenchmark({
        run: () => measureTab(mainWindow, test),
        iterations: opts.iterations,
        warmups: opts.warmups,
      });
      if (writeBenchmarkResult(report, test.name, result, test.targetMs, "Tabs")) {
        reviewCount += 1;
      }
      report.line("");
    }
    await captureMemory("Memory After Tab Tests");

    report.line("=== Search And Filter Responsiveness ===");
    for (const test of SEARCH_TESTS) {
      const result = await runBenchmark({
        run: () => measureSearch(mainWindow, test),
        iterations: opts.iterations,
        warmups: opts.warmups,
      });
      if (writeBenchmarkResult(report, test.name, result, test.targetMs, "Search")) {
        reviewCount += 1;
      }
      report.line("");
    }
    await captureMemory("Memory After Search Tests");

    report.line("=== End-To-End UI Workflow ===");
    const workflowResult = await runBenchmark({
      run: () => runBillingUiWorkflow(mainWindow, database),
      iterations: Math.min(opts.iterations, 3),
      warmups: 0,
    });
    if (writeBenchmarkResult(report, "Tables -> Billing -> Add Items -> Settle", workflowResult, 3000, "Workflow")) {
      reviewCount += 1;
    }
    report.line("");
    await captureMemory("Memory After Billing Workflow");

    report.line("=== Export And Printing ===");
    const pdfResult = await runBenchmark({
      run: () => runPdfExport(mainWindow),
      iterations: Math.min(opts.iterations, 3),
      warmups: 0,
    });
    if (writePdfBenchmarkResult(report, pdfResult, 7000)) {
      reviewCount += 1;
    }
    report.line("");
    await captureMemory("Memory After PDF Export");

    const csvResult = await runBenchmark({
      run: () => runAuditCsvExport(mainWindow, session),
      iterations: Math.min(opts.iterations, 3),
      warmups: 0,
    });
    if (writeBenchmarkResult(report, "Audit CSV Export", csvResult, 1000, "Export")) {
      reviewCount += 1;
    }
    report.line("");

    report.line("=== Full App Walk ===");
    const walkResult = await runBenchmark({
      run: () => runFullAppWalk(mainWindow),
      iterations: 1,
      warmups: 0,
    });
    if (writeBenchmarkResult(report, "Full App Walk (all pages and tabs)", walkResult, 45000, "Load")) {
      reviewCount += 1;
    }
    report.line("");
    await captureMemory("Memory After Full App Walk");

    report.line("=== Long-Running ===");
    const repeatedNavResult = await runBenchmark({
      run: () => runRepeatedNavigation(mainWindow, opts.navCycles, takeMemory),
      iterations: 1,
      warmups: 0,
    });
    const repeatedNavigationTargetMs = 2500 * opts.navCycles;
    if (writeBenchmarkResult(report, `Repeated Navigation (${opts.navCycles} cycles)`, repeatedNavResult, repeatedNavigationTargetMs)) {
      reviewCount += 1;
    }
    report.line("");
    await captureMemory("Memory After Repeated Navigation");

    const repeatedNavigationMemorySummary = repeatedNavResult.result?.pageMemorySummary || [];
    printRepeatedNavigationMemorySummary(report, repeatedNavigationMemorySummary);

    const repeatedNavigationMemory = repeatedNavResult.result?.memorySamples || [];
    if (repeatedNavigationMemory.length) {
      report.line("=== Repeated Navigation Memory Attribution ===");
      printMemorySeries(report, repeatedNavigationMemory);
    }

    const daySimulationResult = await runBenchmark({
      run: createDaySimulation(posService, database, opts.dayCycles),
      iterations: 1,
      warmups: 0,
    });
    const daySimulationTargetMs = Math.max(1, 250 * opts.dayCycles);
    if (writeBenchmarkResult(report, `Day Simulation (${opts.dayCycles} orders, rolled back)`, daySimulationResult, daySimulationTargetMs)) {
      reviewCount += 1;
    }
    report.line("");
    await captureMemory("Memory After Day Simulation");

    report.line("=== Memory Checkpoints ===");
    printMemorySeries(report, memoryCheckpoints);

    const firstMemory = memoryCheckpoints[0];
    const finalMemory = memoryCheckpoints[memoryCheckpoints.length - 1];
    if (firstMemory && finalMemory) {
      report.line("Memory Growth From Login To Final Checkpoint");
      report.line(`Total Working Set: ${formatMb(finalMemory.totalWorkingSetKb - firstMemory.totalWorkingSetKb)}`);
      report.line(`Renderer Working Set: ${formatMb(finalMemory.rendererWorkingSetKb - firstMemory.rendererWorkingSetKb)}`);
      report.line(`Main Private: ${formatMb(finalMemory.mainPrivateKb - firstMemory.mainPrivateKb)}`);
    }
    report.line("");

    report.line(
      reviewCount
        ? `Overall UI performance: REVIEW (${reviewCount} benchmark${reviewCount === 1 ? "" : "s"} over guideline)`
        : "Overall UI performance: OK (all P95 values under guidelines)",
    );
    report.line(`Saved report: ${outputPath}`);
    report.writeToFile(outputPath);
    writeJsonReport(outputPath, {
      generatedAt: new Date().toISOString(),
      database: PERF_DB_PATH,
      renderer: rendererSource.type === "url" ? rendererSource.value : path.relative(ROOT_DIR, rendererSource.value),
      iterations: opts.iterations,
      warmups: opts.warmups,
      navCycles: opts.navCycles,
      dayCycles: opts.dayCycles,
      overall: reviewCount ? "REVIEW" : "OK",
      reviewCount,
      startup: {
        dbReadyMs: Number(dbReadyMs.toFixed(1)),
        rendererLoadMs: Number(rendererLoadMs.toFixed(1)),
        loginPageMs: Number(loginPageMs.toFixed(1)),
        firstScreenMs: Number(firstScreenMs.toFixed(1)),
      },
      memory: memoryCheckpoints.map((snapshot) => ({
        label: snapshot.label,
        totalWorkingSetMb: Number((snapshot.totalWorkingSetKb / 1024).toFixed(1)),
        rendererWorkingSetMb: Number((snapshot.rendererWorkingSetKb / 1024).toFixed(1)),
        mainPrivateMb: Number((snapshot.mainPrivateKb / 1024).toFixed(1)),
      })),
      benchmarks: collectedRecords,
    });
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    if (closeDb) {
      closeDb();
    }
    if (app?.quit) {
      app.quit();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  try {
    const { app } = loadElectronModule();
    if (app?.isReady?.()) {
      app.exit(1);
    }
  } catch {}
  setTimeout(() => process.exit(1), 100);
});
