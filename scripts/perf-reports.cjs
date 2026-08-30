#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");

const ROOT_DIR = path.resolve(__dirname, "..");
const PERF_DB_PATH = path.join(ROOT_DIR, "data", "perf", "restaurant-pos-perf.sqlite");
const PERF_DIR = path.dirname(PERF_DB_PATH);
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const parsed = {
    warmups: 3,
    iterations: 20,
    historyLimit: 25,
    loadCycles: 50,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }

    if (rawKey === "warmups") {
      parsed.warmups = parseNonNegativeInt(value, "warmups");
    } else if (rawKey === "iterations") {
      parsed.iterations = parsePositiveInt(value, "iterations");
    } else if (rawKey === "history-limit") {
      parsed.historyLimit = parsePositiveInt(value, "history-limit");
    } else if (rawKey === "load-cycles") {
      parsed.loadCycles = parsePositiveInt(value, "load-cycles");
    } else if (rawKey === "output") {
      parsed.output = path.resolve(String(value || "").trim());
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

function registerTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = "1";
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: "CommonJS",
    moduleResolution: "Node",
  });
  require("ts-node/register/transpile-only");
}

function isNativeModuleMismatch(error) {
  const message = String(error?.message || error || "");
  return (
    !process.versions.electron &&
    !process.env.POS_PERF_ELECTRON_CHILD &&
    /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(message)
  );
}

function rerunWithElectron() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string") {
    throw new Error("Unable to locate Electron executable for performance script fallback.");
  }
  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    env: { ...process.env, POS_PERF_ELECTRON_CHILD: "1" },
    encoding: "utf8",
  });
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

function handleElectronFallback() {
  try {
    rerunWithElectron();
  } catch (fallbackError) {
    console.error(fallbackError instanceof Error ? fallbackError.message : fallbackError);
    finish(1);
  }
}

function filterElectronStderr(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => line && !/crashpad|CreateFile: Access is denied/i.test(line))
    .map((line) => `${line}\n`)
    .join("");
}

function finish(exitCode) {
  if (process.versions.electron) {
    process.exit(exitCode);
  }
  process.exitCode = exitCode;
}

function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatMoneyPaise(value) {
  return `₹${(value / 100).toFixed(2)}`;
}

function formatReportMoneyPaise(value) {
  return `Rs ${(value / 100).toFixed(2)}`;
}

function timestampForFileName() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
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
      fs.writeFileSync(path.join(PERF_DIR, "latest-report.txt"), payload, "utf8");
      return outputPath;
    },
  };
}

function utcDayRange(timestamp) {
  const date = new Date(timestamp);
  const from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { from, to: from + DAY_MS - 1 };
}

function utcMonthRange(timestamp) {
  const date = new Date(timestamp);
  const from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const to = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1;
  return { from, to };
}

function getDataBounds(database) {
  return database
    .prepare(
      "SELECT MIN(received_at) AS minReceivedAt, MAX(received_at) AS maxReceivedAt FROM payments WHERE status = 'completed'",
    )
    .get();
}

function getRanges(bounds) {
  const maxReceivedAt = Number(bounds.maxReceivedAt || 0);
  const minReceivedAt = Number(bounds.minReceivedAt || 0);
  if (!maxReceivedAt || !minReceivedAt) {
    throw new Error("No completed payments found. Run npm run perf:seed first.");
  }

  return [
    { label: "Today", targetMs: 200, opts: utcDayRange(maxReceivedAt) },
    { label: "Current Month", targetMs: 500, opts: utcMonthRange(maxReceivedAt) },
    { label: "Large Range", targetMs: 1500, opts: { from: minReceivedAt, to: maxReceivedAt } },
  ];
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

function rowCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "number") {
    return value;
  }
  if (value?.categorySales && value?.itemSales) {
    return value.categorySales.length + value.itemSales.length;
  }
  if (value && typeof value === "object") {
    if (Number.isFinite(value.orders)) {
      return Number(value.orders);
    }
    return Object.keys(value).length;
  }
  return 0;
}

function runBenchmark({ run, iterations, warmups, rowCountFn }) {
  let latestResult;
  for (let index = 0; index < warmups; index += 1) {
    latestResult = run();
  }

  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    latestResult = run();
    samples.push(performance.now() - startedAt);
  }

  return {
    result: latestResult,
    stats: statsFor(samples),
    rows: rowCountFn ? rowCountFn(latestResult) : rowCount(latestResult),
  };
}

function checkReconciliation(posService, range) {
  const summary = posService.getSalesSummary(range.opts);
  const product = posService.getProductSalesReport(range.opts);
  const summaryPaise = toPaise(summary.total);
  const categoryPaise = product.categorySales.reduce((sum, row) => sum + toPaise(row.sales), 0);
  const itemPaise = product.itemSales.reduce((sum, row) => sum + toPaise(row.sales), 0);
  const ok = categoryPaise === itemPaise && itemPaise === summaryPaise;

  return {
    ok,
    summaryPaise,
    categoryPaise,
    itemPaise,
  };
}

function runInRolledBackSavepoint(database, name, fn) {
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

function createBillingFlowBenchmark(posService, database) {
  const items = posService.getItems().slice(0, 3);
  if (!items.length) {
    throw new Error("No menu items found. Run npm run perf:seed first.");
  }

  return () =>
    runInRolledBackSavepoint(database, "perf_billing_flow", () => {
      const order = posService.createOrder({
        orderType: "takeaway",
        createdBy: null,
        meta: { perfBenchmark: true },
      });
      let current = order;
      items.forEach((item, index) => {
        current = posService.addItemToOrder(current._id, {
          name: item.name,
          qty: index + 1,
          rate: item.price,
          menuItemId: item._id,
          categoryName: item.category || null,
        });
      });
      return posService.setOrderPaid(current._id, {
        method: "cash",
        amount: current.total,
        amountPaid: current.total,
        receivedBy: null,
      });
    });
}

function computeReceiptTotals(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const itemSubtotal = Number(
    order?.subtotal ??
      items.reduce((sum, item) => sum + Number(item?.qty || 0) * Number(item?.rate || 0), 0),
  );
  const discountPercent = Number(order?.discountPercent || 0);
  const discountTotal = Number(
    order?.discountTotal ?? (discountPercent > 0 ? (itemSubtotal * discountPercent) / 100 : 0),
  );
  const taxableSubtotal = Math.max(0, itemSubtotal - discountTotal);
  const taxTotal = Number(order?.taxTotal || 0);
  const total = Number(order?.total || taxableSubtotal + taxTotal);
  return {
    itemSubtotal,
    subtotal: itemSubtotal,
    preDiscountTotal: itemSubtotal,
    discountTotal,
    taxableSubtotal,
    taxTotal,
    cgst: taxTotal / 2,
    sgst: taxTotal / 2,
    total,
    gstEnabled: taxTotal > 0,
  };
}

function createReceiptKotRenderBenchmark(posService, escpos) {
  const order = posService.listPaidOrders({ limit: 1, offset: 0 })[0];
  if (!order) {
    throw new Error("No paid orders found. Run npm run perf:seed first.");
  }

  return () => {
    const totals = computeReceiptTotals(order);
    const tableNum = order.tableId ?? null;
    const receiptLines = [
      "BIGBOLD:Restaurant POS",
      "SUBHEADER:PERF RECEIPT",
      tableNum ? `CENTER:Table No: ${tableNum}` : "CENTER:Takeaway",
      "SEP",
      ...((order.items || []).slice(0, 12).map((item) => {
        const qty = Number(item.qty || 1);
        const rate = Number(item.rate || 0);
        return `LEFTB:  ${String(item.name || "Item").slice(0, 20).padEnd(20)}${String(qty).padStart(4)}${String(rate.toFixed(2)).padStart(8)}`;
      })),
      "SEP",
      `BOLDLEFT:  Grand Total ${totals.total.toFixed(2)}`,
      "CUT",
    ];
    const kotLines = [
      "BIGBOLD:Restaurant POS",
      "SUBHEADER:---------KOT---------",
      tableNum ? `LEFT:  Table No: ${tableNum}` : "LEFT:  Takeaway",
      "SEP",
      ...((order.items || []).slice(0, 12).map((item) => {
        const qty = Number(item.qty || 1);
        return `LEFTDH:  ${String(item.name || "Item").slice(0, 32).padEnd(32)}${String(qty).padStart(8)}`;
      })),
      "CUT",
    ];
    const receiptBuffer = escpos.buildEscPosBuffer("receipt", "", receiptLines, "Restaurant POS");
    const kotBuffer = escpos.buildEscPosBuffer("kot", "", kotLines, "Restaurant POS");
    return { receiptLines, kotLines, receiptBytes: receiptBuffer.length, kotBytes: kotBuffer.length };
  };
}

function createPrintQueueAddBenchmark(posService, database) {
  return () =>
    runInRolledBackSavepoint(database, "perf_print_queue_add", () =>
      posService.addPrintJob({
        printerName: "Perf Printer",
        jobType: "receipt",
        content: { perf: true, lines: ["PERF RECEIPT", "CUT"] },
      }),
    );
}

function getAuditRange(database) {
  const row = database
    .prepare("SELECT MIN(timestamp) AS minTimestamp, MAX(timestamp) AS maxTimestamp FROM audit_logs")
    .get();
  const minTimestamp = Number(row?.minTimestamp || 0);
  const maxTimestamp = Number(row?.maxTimestamp || 0);
  if (!minTimestamp || !maxTimestamp) {
    return null;
  }
  return { from: minTimestamp, to: maxTimestamp };
}

function writeJsonReport(outputPath, payload) {
  const jsonPath = outputPath.replace(/\.txt$/i, ".json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(PERF_DIR, "latest-report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jsonPath;
}

function todayDateOnly() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shiftDateOnly(dateText, days) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createMixedLoadBurst(posService, range, cycles) {
  const today = todayDateOnly();
  return () => {
    for (let index = 0; index < cycles; index += 1) {
      posService.getTables();
      posService.getOpenOrders();
      posService.getItems();
      if (index % 2 === 0) {
        posService.getSalesSummary(range);
        posService.listAttendance({ date: today });
      }
      if (index % 3 === 0) {
        posService.listPaidOrders({ ...range, limit: 25, offset: 0 });
        posService.listExpenses({ ...range, limit: 50 });
      }
      if (index % 5 === 0) {
        posService.getProductSalesReport(range);
        posService.getAudits({ limit: 25, offset: 0 });
        posService.listGroceryLists({ limit: 30 });
      }
    }
    return { rows: cycles };
  };
}

function writeBenchmarkResult(report, records, name, label, result, targetMs) {
  const overTarget = result.stats.p95 > targetMs;
  const displayName = label ? `${name} (${label})` : name;
  report.line(displayName);
  report.line(`Avg: ${formatMs(result.stats.avg)}`);
  report.line(`P95: ${formatMs(result.stats.p95)}`);
  report.line(`Max: ${formatMs(result.stats.max)}`);
  report.line(`Rows: ${result.rows}`);
  if (overTarget) {
    report.line(`Guideline: REVIEW (P95 over ${formatMs(targetMs)})`);
  } else {
    report.line(`Guideline: OK (P95 under ${formatMs(targetMs)})`);
  }
  records.push({
    layer: "service",
    group: label || "Application Workflows",
    name: displayName,
    avg: Number(result.stats.avg.toFixed(1)),
    p95: Number(result.stats.p95.toFixed(1)),
    max: Number(result.stats.max.toFixed(1)),
    rows: result.rows,
    targetMs,
    guideline: overTarget ? "REVIEW" : "OK",
  });
  return overTarget;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(PERF_DB_PATH)) {
    throw new Error(`Performance database not found: ${PERF_DB_PATH}. Run npm run perf:seed first.`);
  }

  process.env.POS_DB_PATH_OVERRIDE = PERF_DB_PATH;
  registerTsNode();

  const { closeDb, getDb, initializeDatabase } = require(path.join(ROOT_DIR, "electron", "db", "sqlite"));
  const { posService } = require(path.join(ROOT_DIR, "electron", "services", "posService"));
  const escpos = require(path.join(ROOT_DIR, "electron", "printing", "escpos"));

  await initializeDatabase();
  const database = getDb();
  const ranges = getRanges(getDataBounds(database));
  let failed = false;
  let reviewCount = 0;
  const records = [];
  const report = createReportLogger();
  const outputPath = opts.output || path.join(PERF_DIR, `report-${timestampForFileName()}.txt`);

  report.line(`Performance database: ${PERF_DB_PATH}`);
  report.line(`Iterations: ${opts.iterations}`);
  report.line(`Warmups: ${opts.warmups}`);
  report.line(`Load cycles: ${opts.loadCycles}`);
  report.line("Targets are guidelines, not build blockers.");
  report.line("");

  for (const range of ranges) {
    report.line(`=== ${range.label} ===`);

    const benchmarks = [
      {
        name: "Sales Summary",
        run: () => posService.getSalesSummary(range.opts),
      },
      {
        name: "Payment Breakdown",
        run: () => posService.getPaymentBreakdown(range.opts),
      },
      {
        name: "Product Sales",
        run: () => posService.getProductSalesReport(range.opts),
      },
      {
        name: "Profitability",
        run: () => posService.getProfitabilitySummary(range.opts),
      },
      {
        name: "Order History List",
        run: () => posService.listPaidOrders({ ...range.opts, limit: opts.historyLimit, offset: 0 }),
      },
      {
        name: "Order History Count",
        run: () => posService.countPaidOrders(range.opts),
      },
    ];

    for (const benchmark of benchmarks) {
      const result = runBenchmark({
        run: benchmark.run,
        iterations: opts.iterations,
        warmups: opts.warmups,
      });
      if (writeBenchmarkResult(report, records, benchmark.name, range.label, result, range.targetMs)) {
        reviewCount += 1;
      }
      if (benchmark.name === "Product Sales") {
        const reconciliation = checkReconciliation(posService, range);
        if (!reconciliation.ok) {
          failed = true;
          report.line("Reconciliation: FAIL");
          report.line(`Sales Summary: ${formatReportMoneyPaise(reconciliation.summaryPaise)}`);
          report.line(`Category Sales: ${formatReportMoneyPaise(reconciliation.categoryPaise)}`);
          report.line(`Item Sales: ${formatReportMoneyPaise(reconciliation.itemPaise)}`);
        } else {
          report.line(`Reconciliation: PASS (${formatReportMoneyPaise(reconciliation.summaryPaise)})`);
        }
      }
      report.line("");
    }
  }

  const auditRange = getAuditRange(database);
  const todayRange = ranges[0]?.opts || {};
  const largeRange = ranges[ranges.length - 1]?.opts || {};
  const today = todayDateOnly();
  const weekAgo = shiftDateOnly(today, -6);
  const monthAgo = shiftDateOnly(today, -29);
  const appBenchmarks = [
    {
      name: "Menu Items List",
      targetMs: 200,
      run: () => posService.getItems(),
    },
    {
      name: "Categories List",
      targetMs: 100,
      run: () => posService.getCategories(),
    },
    {
      name: "Tables List",
      targetMs: 100,
      run: () => posService.getTables(),
    },
    {
      name: "Tables Snapshot",
      targetMs: 200,
      run: () => posService.getTablesSnapshot(),
    },
    {
      name: "Open Orders",
      targetMs: 150,
      run: () => posService.getOpenOrders(),
    },
    {
      name: "Customers List",
      targetMs: 300,
      run: () => posService.listCustomers(),
    },
    {
      name: "Staff List",
      targetMs: 300,
      run: () => posService.listStaff({ includeInactive: true }),
    },
    {
      name: "Users List",
      targetMs: 100,
      run: () => posService.listUsers(),
    },
    {
      name: "Audit List",
      label: "Today",
      targetMs: 200,
      run: () => posService.getAudits({ ...todayRange, limit: 25, offset: 0 }),
    },
    {
      name: "Audit Count",
      label: "Large Range",
      targetMs: 500,
      run: () => posService.countAudits(auditRange || largeRange),
    },
    {
      name: "Audit Search Count",
      label: "Large Range",
      targetMs: 1000,
      run: () => posService.countAudits({ ...(auditRange || largeRange), search: "order" }),
    },
    {
      name: "Grocery Items List",
      targetMs: 400,
      run: () => posService.listGroceryItems(),
    },
    {
      name: "Grocery Lists",
      targetMs: 500,
      run: () => posService.listGroceryLists({ limit: 30 }),
    },
    {
      name: "Grocery Purchase Headers",
      targetMs: 500,
      run: () => posService.listGroceryPurchaseHeaders({ limit: 50 }),
    },
    {
      name: "Grocery Purchase Lines",
      targetMs: 400,
      run: () => posService.listGroceryPurchases({ from: 0, to: Date.now(), limit: 100 }),
    },
    {
      name: "Vendors List",
      targetMs: 200,
      run: () => posService.listVendors({ includeInactive: true }),
    },
    {
      name: "Expense Categories",
      targetMs: 100,
      run: () => posService.listExpenseCategories(),
    },
    {
      name: "Expenses List",
      targetMs: 400,
      run: () => posService.listExpenses({ limit: 50 }),
    },
    {
      name: "Attendance Daily",
      targetMs: 300,
      run: () => posService.listAttendance({ date: today }),
    },
    {
      name: "Attendance Week",
      targetMs: 800,
      run: () => posService.listAttendanceRange({ fromDate: weekAgo, toDate: today }),
    },
    {
      name: "Attendance Month",
      targetMs: 1500,
      run: () => posService.listAttendanceRange({ fromDate: monthAgo, toDate: today }),
    },
    {
      name: "Salary Advances",
      targetMs: 400,
      run: () => posService.listSalaryAdvances({ limit: 200 }),
    },
    {
      name: "Print Queue Pending",
      targetMs: 200,
      run: () => posService.listPrintJobs("pending"),
    },
    {
      name: "Print Queue Failed",
      targetMs: 200,
      run: () => posService.listPrintJobs("failed"),
    },
    {
      name: "Receipt/KOT Render",
      targetMs: 100,
      run: createReceiptKotRenderBenchmark(posService, escpos),
      rowCountFn: (result) =>
        Number(result?.receiptLines?.length || 0) + Number(result?.kotLines?.length || 0),
    },
    {
      name: "Print Queue Add",
      targetMs: 200,
      run: createPrintQueueAddBenchmark(posService, database),
      rowCountFn: () => 1,
    },
    {
      name: "Billing Takeaway Flow",
      targetMs: 500,
      run: createBillingFlowBenchmark(posService, database),
      rowCountFn: () => 1,
    },
  ];

  report.line("=== Application Workflows ===");
  for (const benchmark of appBenchmarks) {
    const result = runBenchmark({
      run: benchmark.run,
      iterations: opts.iterations,
      warmups: opts.warmups,
      rowCountFn: benchmark.rowCountFn,
    });
    if (writeBenchmarkResult(report, records, benchmark.name, benchmark.label, result, benchmark.targetMs)) {
      reviewCount += 1;
    }
    report.line("");
  }

  report.line("=== Mixed Load Burst ===");
  const mixedLoadResult = runBenchmark({
    run: createMixedLoadBurst(posService, todayRange, opts.loadCycles),
    iterations: Math.min(opts.iterations, 5),
    warmups: 1,
    rowCountFn: () => opts.loadCycles,
  });
  const mixedLoadTargetMs = Math.max(1, 40 * opts.loadCycles);
  if (
    writeBenchmarkResult(
      report,
      records,
      `Busy-Terminal Mix (${opts.loadCycles} cycles)`,
      "Load",
      mixedLoadResult,
      mixedLoadTargetMs,
    )
  ) {
    reviewCount += 1;
  }
  report.line("");

  const overall = reviewCount
    ? `REVIEW (${reviewCount} benchmark${reviewCount === 1 ? "" : "s"} over guideline)`
    : "OK (all P95 values under guidelines)";
  report.line(`Overall performance: ${overall}`);
  report.line(failed ? "Overall reconciliation: FAIL" : "Overall reconciliation: PASS");
  report.line(`Saved report: ${outputPath}`);
  report.writeToFile(outputPath);
  writeJsonReport(outputPath, {
    generatedAt: new Date().toISOString(),
    database: PERF_DB_PATH,
    iterations: opts.iterations,
    warmups: opts.warmups,
    loadCycles: opts.loadCycles,
    overall: reviewCount ? "REVIEW" : "OK",
    reviewCount,
    reconciliation: failed ? "FAIL" : "PASS",
    benchmarks: records,
  });

  closeDb();
  if (failed) {
    finish(1);
    return;
  }
  finish(0);
}

main().catch((error) => {
  if (isNativeModuleMismatch(error)) {
    handleElectronFallback();
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  finish(1);
});
