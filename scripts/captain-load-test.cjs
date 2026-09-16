#!/usr/bin/env node
/**
 * Simulate many Captain LAN clients against a running POS Local Gateway.
 *
 * Does not need physical phones: opens N auth sessions + SSE streams, then a
 * subset of writers run open-table → add-item → (optional) send-kot cycles on
 * distinct tables, while every client refreshes tables/kots on SSE events
 * (mirrors CaptainApp refresh amplification).
 *
 * Prerequisites:
 *   1. Desktop POS running with Local Gateway on
 *   2. Captain users exist (demo-seed: priya/rahul/amit, password Captain1!)
 *   3. Pairing code from the desktop Gateway chip
 *
 * Examples:
 *   node scripts/captain-load-test.cjs --pairing abc123
 *   node scripts/captain-load-test.cjs --base-url http://192.168.1.10:4747 --pairing abc123 --clients 20 --writers 8 --duration 60
 *   npm run captain:load -- --pairing abc123 --send-kot
 */

const { performance } = require("perf_hooks");
const { randomBytes } = require("crypto");

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:4747",
  clients: 20,
  writers: 8,
  durationSec: 60,
  mutPerSec: 1.5,
  itemsPerCycle: 2,
  sendKot: false,
  sameTable: false,
  username: "priya",
  password: "Captain1!",
  pairing: "",
  timeoutMs: 20_000,
};

function printHelp() {
  console.log(`Usage: node scripts/captain-load-test.cjs --pairing <code> [options]

Required:
  --pairing <code>       POS Local Gateway pairing code (shown on desktop)

Options:
  --base-url <url>       Gateway URL (default ${DEFAULTS.baseUrl})
  --clients <n>          Concurrent sessions + SSE (default ${DEFAULTS.clients})
  --writers <n>          Clients that mutate orders (default ${DEFAULTS.writers})
  --duration <sec>       How long writers run (default ${DEFAULTS.durationSec})
  --mut-per-sec <n>      Aggregate mutation cycles / second (default ${DEFAULTS.mutPerSec})
  --items-per-cycle <n>  Items added per cycle (default ${DEFAULTS.itemsPerCycle})
  --send-kot             Also call send-kot (can hit real kitchen printer)
  --same-table           Parallel writers race one table (expects some 409 order-conflict)
  --username <name>      Login username (default ${DEFAULTS.username})
  --password <pass>      Login password (default demo Captain1!)
  --timeout-ms <n>       HTTP timeout (default ${DEFAULTS.timeoutMs})
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const parsed = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const needsValue = ![
      "send-kot",
      "same-table",
      "help",
    ].includes(rawKey);
    const value = inlineValue !== undefined ? inlineValue : needsValue ? argv[++i] : true;
    if (needsValue && (value === undefined || String(value).startsWith("--"))) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    switch (rawKey) {
      case "base-url":
        parsed.baseUrl = String(value).replace(/\/$/, "");
        break;
      case "clients":
        parsed.clients = parsePositiveInt(value, "clients");
        break;
      case "writers":
        parsed.writers = parsePositiveInt(value, "writers");
        break;
      case "duration":
        parsed.durationSec = parsePositiveInt(value, "duration");
        break;
      case "mut-per-sec":
        parsed.mutPerSec = parsePositiveNumber(value, "mut-per-sec");
        break;
      case "items-per-cycle":
        parsed.itemsPerCycle = parsePositiveInt(value, "items-per-cycle");
        break;
      case "send-kot":
        parsed.sendKot = true;
        break;
      case "same-table":
        parsed.sameTable = true;
        break;
      case "username":
        parsed.username = String(value);
        break;
      case "password":
        parsed.password = String(value);
        break;
      case "pairing":
        parsed.pairing = String(value).trim();
        break;
      case "timeout-ms":
        parsed.timeoutMs = parsePositiveInt(value, "timeout-ms");
        break;
      case "help":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown option: --${rawKey}`);
    }
  }
  return parsed;
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return n;
}

function parsePositiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--${label} must be a positive number`);
  }
  return n;
}

function clientOpId(prefix) {
  return `${prefix}:${Date.now().toString(36)}:${randomBytes(4).toString("hex")}`;
}

function deviceId(index) {
  return `loadtest:device:${index}:${randomBytes(4).toString("hex")}`;
}

function percentile(sorted, p) {
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] || 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] || 0,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStats() {
  return {
    loginMs: [],
    openTableMs: [],
    addItemMs: [],
    sendKotMs: [],
    refreshMs: [],
    errors: Object.create(null),
    sseEvents: 0,
    refreshes: 0,
    cycles: 0,
    logins: 0,
    conflicts: 0,
  };
}

function bumpError(stats, label) {
  const key = String(label || "unknown");
  stats.errors[key] = (stats.errors[key] || 0) + 1;
}

async function requestJson(baseUrl, path, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const headers = {
    "Content-Type": "application/json",
    "X-Device-Id": options.deviceId || "loadtest:device",
    ...(options.headers || {}),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.clientOpId) {
    headers["X-Client-Op-Id"] = options.clientOpId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    const ms = performance.now() - started;
    if (!res.ok) {
      const err = new Error(String(data?.error || `http-${res.status}`));
      err.status = res.status;
      err.ms = ms;
      throw err;
    }
    return { data, ms };
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeout = new Error("request-timeout");
      timeout.status = 0;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function login(baseUrl, opts, index, stats) {
  const id = deviceId(index);
  const { data, ms } = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    deviceId: id,
    timeoutMs: opts.timeoutMs,
    body: {
      username: opts.username,
      password: opts.password,
      pairingCode: opts.pairing,
      deviceId: id,
    },
  });
  stats.loginMs.push(ms);
  stats.logins += 1;
  return {
    index,
    deviceId: id,
    token: data.sessionToken,
    username: data.user?.username || opts.username,
  };
}

function openSse(baseUrl, session, stats, onDomainEvent) {
  const controller = new AbortController();
  const run = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/events`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-Device-Id": session.deviceId,
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        bumpError(stats, res.status === 401 ? "sse-auth-required" : `sse-failed-${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            const type = String(event?.type || "");
            if (
              type === "orders-changed" ||
              type === "tables-changed" ||
              type === "activity-changed"
            ) {
              stats.sseEvents += 1;
            }
            onDomainEvent(session, event);
          } catch {
            // ignore malformed SSE
          }
        }
      }
      if (!controller.signal.aborted) {
        bumpError(stats, "sse-ended");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        bumpError(stats, String(err?.message || "sse-failed"));
      }
    }
  };
  void run();
  return () => controller.abort();
}

async function refreshLikeCaptain(baseUrl, session, stats, opts) {
  const started = performance.now();
  try {
    await Promise.all([
      requestJson(baseUrl, "/api/tables", {
        token: session.token,
        deviceId: session.deviceId,
        timeoutMs: opts.timeoutMs,
      }),
      requestJson(baseUrl, "/api/kots", {
        token: session.token,
        deviceId: session.deviceId,
        timeoutMs: opts.timeoutMs,
      }),
    ]);
    stats.refreshMs.push(performance.now() - started);
    stats.refreshes += 1;
  } catch (err) {
    bumpError(stats, `refresh:${err.message}`);
  }
}

async function pickTables(baseUrl, session, opts) {
  const { data } = await requestJson(baseUrl, "/api/tables", {
    token: session.token,
    deviceId: session.deviceId,
    timeoutMs: opts.timeoutMs,
  });
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  if (!tables.length) {
    throw new Error("no-tables");
  }
  return tables;
}

async function pickMenuItem(baseUrl, session, opts) {
  const { data } = await requestJson(baseUrl, "/api/menu", {
    token: session.token,
    deviceId: session.deviceId,
    timeoutMs: opts.timeoutMs,
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  const usable = items.filter((item) => item && item.name && Number(item.price || item.rate || 0) >= 0);
  if (!usable.length) {
    throw new Error("no-menu-items");
  }
  return usable[Math.floor(Math.random() * usable.length)];
}

function orderIdOf(order) {
  // OrderDto uses `_id` (Captain reads next._id); tolerate id/orderId too.
  return String(order?._id || order?.id || order?.orderId || "").trim();
}

function menuItemIdOf(item) {
  return item?._id || item?.id || undefined;
}

function menuRate(item) {
  if (item.rate != null) {
    return Number(item.rate);
  }
  if (item.price != null) {
    return Number(item.price);
  }
  return 0;
}

async function runWriterCycle(baseUrl, session, tableId, menuItem, stats, opts) {
  const openOp = clientOpId("open-table");
  const { data: opened, ms: openMs } = await requestJson(baseUrl, "/api/orders/open-table", {
    method: "POST",
    token: session.token,
    deviceId: session.deviceId,
    clientOpId: openOp,
    timeoutMs: opts.timeoutMs,
    body: { tableId, clientOpId: openOp },
  });
  stats.openTableMs.push(openMs);
  const orderId = orderIdOf(opened);
  if (!orderId) {
    throw new Error("open-table-missing-id");
  }
  let baseUpdatedAt = opened?.updatedAt ?? null;

  for (let i = 0; i < opts.itemsPerCycle; i += 1) {
    const addOp = clientOpId("add-item");
    try {
      const { data: added, ms: addMs } = await requestJson(
        baseUrl,
        `/api/orders/${encodeURIComponent(orderId)}/items`,
        {
          method: "POST",
          token: session.token,
          deviceId: session.deviceId,
          clientOpId: addOp,
          timeoutMs: opts.timeoutMs,
          body: {
            name: String(menuItem.name),
            qty: 1,
            rate: menuRate(menuItem),
            menuItemId: menuItemIdOf(menuItem),
            categoryName: menuItem.category || menuItem.categoryName || undefined,
            clientOpId: addOp,
            baseUpdatedAt,
          },
        },
      );
      stats.addItemMs.push(addMs);
      baseUpdatedAt = added?.updatedAt ?? baseUpdatedAt;
    } catch (err) {
      if (String(err.message) === "order-conflict") {
        stats.conflicts += 1;
        // Reload ticket like Captain, then continue with a fresh version.
        const { data: fresh } = await requestJson(
          baseUrl,
          `/api/orders/${encodeURIComponent(orderId)}`,
          {
            token: session.token,
            deviceId: session.deviceId,
            timeoutMs: opts.timeoutMs,
          },
        );
        baseUpdatedAt = fresh?.updatedAt ?? baseUpdatedAt;
        continue;
      }
      throw err;
    }
  }

  if (opts.sendKot) {
    const kotOp = clientOpId("send-kot");
    try {
      const { data: kotResult, ms: kotMs } = await requestJson(
        baseUrl,
        `/api/orders/${encodeURIComponent(orderId)}/send-kot`,
        {
          method: "POST",
          token: session.token,
          deviceId: session.deviceId,
          clientOpId: kotOp,
          timeoutMs: Math.max(opts.timeoutMs, 60_000),
          body: { clientOpId: kotOp, baseUpdatedAt },
        },
      );
      stats.sendKotMs.push(kotMs);
      baseUpdatedAt = kotResult?.order?.updatedAt ?? baseUpdatedAt;
    } catch (err) {
      if (String(err.message) === "order-conflict") {
        stats.conflicts += 1;
      } else {
        throw err;
      }
    }
  }

  stats.cycles += 1;
}

async function logoutAll(baseUrl, sessions, opts) {
  await Promise.all(
    sessions.map((session) =>
      requestJson(baseUrl, "/api/auth/logout", {
        method: "POST",
        token: session.token,
        deviceId: session.deviceId,
        timeoutMs: Math.min(opts.timeoutMs, 8000),
        body: {},
      }).catch(() => null),
    ),
  );
}

function printReport(opts, stats, elapsedSec) {
  const fmt = (s) =>
    s.count
      ? `${s.count} samples  min=${s.min.toFixed(0)}ms  p50=${s.p50.toFixed(0)}ms  p95=${s.p95.toFixed(0)}ms  max=${s.max.toFixed(0)}ms`
      : "no samples";

  console.log("\n=== Captain load test results ===");
  console.log(`Target:     ${opts.baseUrl}`);
  console.log(`Clients:    ${opts.clients} sessions/SSE`);
  console.log(`Writers:    ${opts.writers}`);
  console.log(`Duration:   ${opts.durationSec}s (elapsed ${elapsedSec.toFixed(1)}s)`);
  console.log(`Send KOT:   ${opts.sendKot ? "yes" : "no"}`);
  console.log(`Same table: ${opts.sameTable ? "yes" : "no"}`);
  console.log(`Logins:     ${stats.logins}`);
  console.log(`Cycles:     ${stats.cycles}`);
  console.log(`Conflicts:  ${stats.conflicts} (order-conflict 409)`);
  console.log(`SSE events: ${stats.sseEvents}`);
  console.log(`Refreshes:  ${stats.refreshes} (tables+kots pairs)`);
  if (stats.cycles > 0) {
    const refreshesPerCycle = stats.refreshes / stats.cycles;
    const eventDeliveriesPerCycle = stats.sseEvents / stats.cycles;
    // Each publish is delivered to every SSE client; normalize to unique wakes.
    const wakesPerCycle = eventDeliveriesPerCycle / Math.max(1, opts.clients);
    console.log(
      `Fan-out:    ~${(stats.refreshes / Math.max(1, stats.sseEvents || 1)).toFixed(2)} refreshes/delivery, ~${refreshesPerCycle.toFixed(
        1,
      )} refreshes/cycle, ~${wakesPerCycle.toFixed(1)} SSE wakes/cycle (unique), ~${eventDeliveriesPerCycle.toFixed(
        1,
      )} deliveries/cycle`,
    );
    // Budget with server 1-wake + client debounce: well under the old ~120/cycle stampede.
    const maxRefreshesPerCycle = Math.max(opts.clients * 2, 40);
    if (refreshesPerCycle > maxRefreshesPerCycle) {
      bumpError(
        stats,
        `fan-out-budget:refreshes/cycle=${refreshesPerCycle.toFixed(1)}>max=${maxRefreshesPerCycle}`,
      );
    }
    // open-table may no-op (no publish) once the table already has an open order.
    const mutationsPerCycle = 1 + opts.itemsPerCycle + (opts.sendKot ? 1 : 0);
    if (wakesPerCycle > mutationsPerCycle * 2.5) {
      bumpError(
        stats,
        `sse-budget:wakes/cycle=${wakesPerCycle.toFixed(1)} (expected ~${mutationsPerCycle} unique publishes/cycle)`,
      );
    }
  }
  console.log(`\nLatency:`);
  console.log(`  login:      ${fmt(summarize(stats.loginMs))}`);
  console.log(`  open-table: ${fmt(summarize(stats.openTableMs))}`);
  console.log(`  add-item:   ${fmt(summarize(stats.addItemMs))}`);
  if (opts.sendKot) {
    console.log(`  send-kot:   ${fmt(summarize(stats.sendKotMs))}`);
  }
  console.log(`  refresh:    ${fmt(summarize(stats.refreshMs))}`);

  const errorKeys = Object.keys(stats.errors);
  if (errorKeys.length) {
    console.log(`\nErrors:`);
    for (const key of errorKeys.sort()) {
      console.log(`  ${key}: ${stats.errors[key]}`);
    }
  } else {
    console.log(`\nErrors: none`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!opts.pairing) {
    printHelp();
    throw new Error("--pairing is required (copy from desktop Gateway chip)");
  }
  if (opts.writers > opts.clients) {
    throw new Error("--writers cannot exceed --clients");
  }

  const stats = createStats();
  console.log(`Checking gateway ${opts.baseUrl} ...`);
  const health = await requestJson(opts.baseUrl, "/api/health", { timeoutMs: 8000 });
  console.log(`Health ok · clients already online: ${health.data.clients ?? "?"}`);

  console.log(`Logging in ${opts.clients} captain session(s) as ${opts.username} ...`);
  const sessions = [];
  for (let i = 0; i < opts.clients; i += 1) {
    try {
      sessions.push(await login(opts.baseUrl, opts, i, stats));
    } catch (err) {
      bumpError(stats, `login:${err.message}`);
      throw new Error(
        `Login failed for client ${i}: ${err.message}. Check pairing code and captain credentials.`,
      );
    }
  }

  const refreshStateBySession = new Map();
  const DEBOUNCE_MS = 200;

  const scheduleDebouncedRefresh = (sess) => {
    let state = refreshStateBySession.get(sess.index);
    if (!state) {
      state = { due: false, inFlight: false, timer: null };
      refreshStateBySession.set(sess.index, state);
    }
    state.due = true;
    if (state.timer != null) {
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      void (async () => {
        if (state.inFlight) {
          state.due = true;
          return;
        }
        state.inFlight = true;
        try {
          do {
            state.due = false;
            await refreshLikeCaptain(opts.baseUrl, sess, stats, opts);
          } while (state.due);
        } finally {
          state.inFlight = false;
        }
      })();
    }, DEBOUNCE_MS);
  };

  const stopSse = sessions.map((session) =>
    openSse(opts.baseUrl, session, stats, (sess, event) => {
      const type = String(event?.type || "");
      if (
        type !== "orders-changed" &&
        type !== "tables-changed" &&
        type !== "activity-changed"
      ) {
        return;
      }
      scheduleDebouncedRefresh(sess);
    }),
  );

  const probe = sessions[0];
  const tables = await pickTables(opts.baseUrl, probe, opts);
  const menuItem = await pickMenuItem(opts.baseUrl, probe, opts);
  const freeFirst = [...tables].sort((a, b) => Number(a.occupied) - Number(b.occupied));
  const writers = sessions.slice(0, opts.writers);
  const tableAssignments = writers.map((session, index) => {
    if (opts.sameTable) {
      return Number(freeFirst[0].id);
    }
    return Number(freeFirst[index % freeFirst.length].id);
  });

  console.log(
    `Writers=${writers.length} · tables=${opts.sameTable ? "shared" : "distinct-ish"} · mode=${
      opts.sameTable ? "parallel-race" : "round-robin"
    } · menu="${menuItem.name}" · mut/s=${opts.mutPerSec} · ${opts.durationSec}s`,
  );
  if (opts.sendKot) {
    console.log("WARNING: --send-kot will hit the configured kitchen printer.");
  }

  const intervalMs = Math.max(50, Math.round(1000 / opts.mutPerSec));
  const deadline = Date.now() + opts.durationSec * 1000;
  const started = performance.now();
  let stopWriters = false;

  let writerLoop;
  if (opts.sameTable) {
    // True concurrency: each writer loops independently against the same table.
    const perWriterInterval = Math.max(50, Math.round(intervalMs * writers.length));
    writerLoop = Promise.all(
      writers.map(async (session, slot) => {
        const tableId = tableAssignments[slot];
        while (!stopWriters && Date.now() < deadline) {
          try {
            await runWriterCycle(opts.baseUrl, session, tableId, menuItem, stats, opts);
          } catch (err) {
            bumpError(stats, `cycle:${err.message}`);
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            break;
          }
          await sleep(Math.min(perWriterInterval, remaining));
        }
      }),
    );
  } else {
    let writerCursor = 0;
    writerLoop = (async () => {
      while (!stopWriters && Date.now() < deadline) {
        const slot = writerCursor % writers.length;
        writerCursor += 1;
        const session = writers[slot];
        const tableId = tableAssignments[slot];
        try {
          await runWriterCycle(opts.baseUrl, session, tableId, menuItem, stats, opts);
        } catch (err) {
          bumpError(stats, `cycle:${err.message}`);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          break;
        }
        await sleep(Math.min(intervalMs, remaining));
      }
    })();
  }

  await writerLoop;
  stopWriters = true;

  // Let in-flight SSE refreshes settle briefly.
  await sleep(1500);
  for (const state of refreshStateBySession.values()) {
    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
  for (const stop of stopSse) {
    stop();
  }
  await logoutAll(opts.baseUrl, sessions, opts);

  const elapsedSec = (performance.now() - started) / 1000;
  printReport(opts, stats, elapsedSec);

  if (opts.sameTable && stats.conflicts < 1) {
    bumpError(stats, "conflict-budget:expected-order-conflict-under-parallel-same-table");
  }

  const hardFailures = Object.entries(stats.errors).filter(([key]) =>
    /login:|open-table|auth-required|request-timeout|no-tables|no-menu|fan-out-budget|sse-budget|conflict-budget/.test(
      key,
    ),
  );
  if (hardFailures.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nCaptain load test failed: ${err.message || err}`);
  process.exitCode = 1;
});
