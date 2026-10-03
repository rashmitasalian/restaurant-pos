import http from "http";
import os from "os";
import fs from "fs";
import path from "path";
import { URL } from "url";
import { randomBytes } from "crypto";
import { app } from "electron";
import { roleHasPermission, type Permission } from "../../src/shared/permissions";
import { normalizeText } from "../../src/shared/validation";
import { posService } from "../services/posService";
import { kotPrintService } from "../services/kotPrintService";
import {
  countLanSessions,
  createLanSession,
  destroyLanSession,
  getLanSession,
  listLanSessions,
  type LanSession,
} from "../services/lanSessionManager";
import { onDomainEvent, publishDomainEvent, type DomainEvent } from "../services/domainEvents";

export const GATEWAY_DEFAULT_PORT = Number(process.env.POS_GATEWAY_PORT || 4747);
const SSE_HEARTBEAT_MS = 20_000;
/** Only these domain events are pushed to Captain phones (avoids 3× stampede). */
const SSE_BROADCAST_TYPES = new Set(["orders-changed", "gateway-status"]);

type JsonBody = Record<string, unknown>;

type SseClient = {
  res: http.ServerResponse;
  token: string;
};

type GatewayState = {
  server: http.Server | null;
  port: number;
  pairingCode: string;
  startedAt: number | null;
  unsubscribeEvents: (() => void) | null;
  sseClients: Set<SseClient>;
  heartbeatTimer: NodeJS.Timeout | null;
};

const state: GatewayState = {
  server: null,
  port: GATEWAY_DEFAULT_PORT,
  pairingCode: randomBytes(3).toString("hex"),
  startedAt: null,
  unsubscribeEvents: null,
  sseClients: new Set(),
  heartbeatTimer: null,
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Client-Op-Id",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("payload-too-large"));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody);
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req: http.IncomingMessage) {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function requireLanAuth(req: http.IncomingMessage, permission?: Permission): LanSession {
  const session = getLanSession(bearerToken(req));
  if (!session) {
    throw new Error("auth-required");
  }
  const user = posService.getUserByUsername(session.username);
  if (!user || user.active === false) {
    destroyLanSession(session.token);
    throw new Error("auth-required");
  }
  if (permission && !roleHasPermission(user.role, permission)) {
    throw new Error("forbidden");
  }
  return session;
}

function publicUser(session: LanSession) {
  return {
    username: session.username,
    role: session.role,
    displayName: session.displayName,
    deviceId: session.deviceId,
  };
}

function readClientOpId(req: http.IncomingMessage, body: JsonBody): string | null {
  return normalizeText(body.clientOpId) || normalizeText(req.headers["x-client-op-id"]) || null;
}

function replayClientOp(
  clientOpId: string | null,
  request: unknown,
): { hit: true; result: unknown } | null {
  if (!clientOpId) {
    return null;
  }
  const existing = posService.getClientOp(clientOpId);
  if (!existing) {
    return null;
  }
  posService.assertClientOpRequest(existing, request);
  return { hit: true, result: existing.result };
}

function rememberOrderClientOp(input: {
  clientOpId: string | null;
  username: string;
  action: string;
  entityId: string;
  request: unknown;
  result: unknown;
}) {
  if (!input.clientOpId) {
    return;
  }
  posService.rememberClientOp({
    id: input.clientOpId,
    username: input.username,
    action: input.action,
    entityId: input.entityId,
    request: input.request,
    result: input.result,
  });
}

export function listPrivateIPv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) {
        continue;
      }
      if (entry.family === "IPv4" || (entry.family as string | number) === 4) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function captainDistRoot() {
  const candidates = [
    path.join(app.getAppPath(), "dist"),
    path.join(__dirname, "..", "..", "dist"),
    path.join(process.cwd(), "dist"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(path.join(candidate, "captain", "index.html"))) ||
    null
  );
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".woff2") {
    return "font/woff2";
  }
  if (ext === ".woff") {
    return "font/woff";
  }
  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }
  if (ext === ".webmanifest") {
    return "application/manifest+json; charset=utf-8";
  }
  return "application/octet-stream";
}

function serveCaptainStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const root = captainDistRoot();
  if (!root) {
    json(res, 503, {
      ok: false,
      error: "captain-ui-not-built",
      message:
        "Captain UI is not available. Run a renderer build so dist/captain exists, then reopen the gateway URL.",
    });
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") {
    rel = "/captain/index.html";
  } else if (!rel.startsWith("/assets/") && !rel.startsWith("/captain/")) {
    rel = `/captain${rel.startsWith("/") ? rel : `/${rel}`}`;
  }
  const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(root, safeRel);
  if (!filePath.startsWith(root)) {
    json(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(root, "captain", "index.html");
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
}

function broadcastSse(event: DomainEvent) {
  if (!SSE_BROADCAST_TYPES.has(event.type)) {
    return;
  }
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of state.sseClients) {
    try {
      client.res.write(data);
    } catch {
      state.sseClients.delete(client);
    }
  }
}

function touchSseSessions() {
  for (const client of state.sseClients) {
    if (!getLanSession(client.token)) {
      try {
        client.res.end();
      } catch {
        // ignore
      }
      state.sseClients.delete(client);
    }
  }
}

function writeSseHeartbeats() {
  touchSseSessions();
  for (const client of state.sseClients) {
    try {
      client.res.write(": ping\n\n");
    } catch {
      state.sseClients.delete(client);
    }
  }
}

function startSseHeartbeat() {
  if (state.heartbeatTimer) {
    return;
  }
  state.heartbeatTimer = setInterval(() => {
    writeSseHeartbeats();
  }, SSE_HEARTBEAT_MS);
  // Unref so heartbeat alone does not keep the process alive in tests.
  state.heartbeatTimer.unref?.();
}

function stopSseHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function readBaseUpdatedAt(body: JsonBody) {
  if (body.baseUpdatedAt === null || body.baseUpdatedAt === undefined || body.baseUpdatedAt === "") {
    return null;
  }
  const value = Number(body.baseUpdatedAt);
  return Number.isFinite(value) ? value : null;
}

function timedJson(res: http.ServerResponse, status: number, body: unknown, label: string, started: number) {
  const ms = Date.now() - started;
  if (ms >= 50) {
    console.info(`[gateway] ${label} ${ms}ms`);
  }
  json(res, status, body);
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        gateway: true,
        port: state.port,
        clients: countLanSessions(),
        pairingRequired: true,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/branding") {
      const cfg = (posService.getConfigDoc("config:branding") || {}) as any;
      json(res, 200, {
        hotelName: String(cfg.hotelName || ""),
        hotelInitials: String(cfg.hotelInitials || ""),
        tagline: String(cfg.tagline || "POINT OF SALE"),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(req);
      const pairingCode = normalizeText(body.pairingCode);
      if (!pairingCode || pairingCode.toLowerCase() !== state.pairingCode.toLowerCase()) {
        json(res, 403, { ok: false, error: "invalid-pairing-code" });
        return;
      }
      const result = posService.loginForGateway(
        String(body.username || ""),
        String(body.password || ""),
      ) as any;
      if (!result.ok || !result.user) {
        json(res, 401, { ok: false, error: result.reason || "invalid-credentials" });
        return;
      }
      if (!roleHasPermission(result.user.role, "order:open")) {
        json(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      const session = createLanSession(
        result.user,
        String(body.deviceId || req.headers["x-device-id"] || ""),
      );
      json(res, 200, {
        ok: true,
        sessionToken: session.token,
        user: publicUser(session),
      });
      publishDomainEvent("gateway-status", { clients: countLanSessions() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      destroyLanSession(bearerToken(req));
      publishDomainEvent("gateway-status", { clients: countLanSessions() });
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      const session = requireLanAuth(req, "order:open");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ username: session.username })}\n\n`);
      const client: SseClient = { res, token: session.token };
      state.sseClients.add(client);
      req.on("close", () => {
        state.sseClients.delete(client);
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/tables") {
      requireLanAuth(req, "order:open");
      const started = Date.now();
      timedJson(res, 200, posService.getTablesSnapshot(), "GET /api/tables", started);
      return;
    }

    if (method === "GET" && url.pathname === "/api/kots") {
      requireLanAuth(req, "order:open");
      const started = Date.now();
      timedJson(res, 200, posService.getCaptainKots(), "GET /api/kots", started);
      return;
    }

    if (method === "GET" && url.pathname === "/api/menu") {
      requireLanAuth(req, "order:open");
      json(res, 200, {
        items: posService.getItems(),
        categories: posService.getCategories(),
      });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/orders/")) {
      requireLanAuth(req, "order:open");
      const orderId = decodeURIComponent(url.pathname.slice("/api/orders/".length));
      const order = posService.getOrderById(orderId);
      if (!order) {
        json(res, 404, { ok: false, error: "order-not-found" });
        return;
      }
      json(res, 200, order);
      return;
    }

    if (method === "POST" && url.pathname === "/api/orders/open-table") {
      const session = requireLanAuth(req, "order:open");
      const body = await readBody(req);
      const tableId = Number(body.tableId);
      if (!Number.isFinite(tableId)) {
        json(res, 400, { ok: false, error: "invalid-table" });
        return;
      }
      const clientOpId = readClientOpId(req, body);
      const request = { tableId };
      const replayed = replayClientOp(clientOpId, request);
      if (replayed) {
        json(res, 200, replayed.result);
        return;
      }
      const order = posService.getOrCreateOrderForTable(tableId, session.username);
      rememberOrderClientOp({
        clientOpId,
        username: session.username,
        action: "order.open-table",
        entityId: String(tableId),
        request,
        result: order,
      });
      json(res, 200, order);
      return;
    }

    if (method === "POST" && url.pathname.match(/^\/api\/orders\/[^/]+\/items$/)) {
      const session = requireLanAuth(req, "order:add-item");
      const orderId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readBody(req);
      const clientOpId = readClientOpId(req, body);
      const baseUpdatedAt = readBaseUpdatedAt(body);
      const item = {
        name: String(body.name || ""),
        qty: Number(body.qty || 1),
        rate: Number(body.rate || 0),
        menuItemId: (body.menuItemId as string) || null,
        categoryName: (body.categoryName as string) || null,
      };
      const request = { orderId, ...item, baseUpdatedAt };
      const replayed = replayClientOp(clientOpId, request);
      if (replayed) {
        json(res, 200, replayed.result);
        return;
      }
      const order = posService.addItemToOrder(orderId, item, session.username, { baseUpdatedAt });
      rememberOrderClientOp({
        clientOpId,
        username: session.username,
        action: "order.add-item",
        entityId: orderId,
        request,
        result: order,
      });
      json(res, 200, order);
      return;
    }

    if (method === "POST" && url.pathname.match(/^\/api\/orders\/[^/]+\/send-kot$/)) {
      const session = requireLanAuth(req, "order:send-kot");
      const orderId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readBody(req);
      const clientOpId = readClientOpId(req, body);
      const baseUpdatedAt = readBaseUpdatedAt(body);
      const result = await kotPrintService.sendKotForOrder(orderId, session.username, {
        clientOpId,
        baseUpdatedAt,
      });
      json(res, 200, result);
      return;
    }

    if (method === "POST" && url.pathname.match(/^\/api\/orders\/[^/]+\/void-item$/)) {
      const session = requireLanAuth(req, "order:void-item");
      const orderId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readBody(req);
      const clientOpId = readClientOpId(req, body);
      const baseUpdatedAt = readBaseUpdatedAt(body);
      const result = await kotPrintService.voidKotLineAndPrint(
        orderId,
        {
          lineId: String(body.lineId || ""),
          finalQty: Number(body.finalQty || 0),
          reason: String(body.reason || ""),
        },
        session.username,
        { clientOpId, baseUpdatedAt },
      );
      json(res, 200, result);
      return;
    }

    if (method === "PUT" && url.pathname.match(/^\/api\/orders\/[^/]+\/lines$/)) {
      const session = requireLanAuth(req, "order:add-item");
      const orderId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readBody(req);
      const clientOpId = readClientOpId(req, body);
      const baseUpdatedAt = readBaseUpdatedAt(body);
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const request = { orderId, lines, baseUpdatedAt };
      const replayed = replayClientOp(clientOpId, request);
      if (replayed) {
        json(res, 200, replayed.result);
        return;
      }
      const order = posService.updateOrderLines(orderId, lines as any, session.username, {
        baseUpdatedAt,
      });
      rememberOrderClientOp({
        clientOpId,
        username: session.username,
        action: "order.update-lines",
        entityId: orderId,
        request,
        result: order,
      });
      json(res, 200, order);
      return;
    }

    json(res, 404, { ok: false, error: "not-found" });
  } catch (error: any) {
    const message = String(error?.message || error || "internal-error");
    const status =
      message === "auth-required"
        ? 401
        : message === "forbidden" || message === "invalid-pairing-code"
          ? 403
          : message === "client-op-conflict" || message === "order-conflict"
            ? 409
            : message.startsWith("kot-") ||
                message.startsWith("order-") ||
                message === "invalid-json"
              ? 400
              : 500;
    json(res, status, { ok: false, error: message });
  }
}

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const host = req.headers.host || `127.0.0.1:${state.port}`;
  const url = new URL(req.url || "/", `http://${host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  serveCaptainStatic(req, res, url);
}

export function getGatewayStatus() {
  return {
    running: Boolean(state.server),
    port: state.port,
    pairingCode: state.pairingCode,
    addresses: listPrivateIPv4Addresses(),
    clients: countLanSessions(),
    phones: listLanSessions(),
    startedAt: state.startedAt,
    urls: listPrivateIPv4Addresses().map((ip) => `http://${ip}:${state.port}`),
  };
}

export function rotateGatewayPairingCode() {
  state.pairingCode = randomBytes(3).toString("hex");
  publishDomainEvent("gateway-status", getGatewayStatus());
  return state.pairingCode;
}

export async function startLocalGateway(port = GATEWAY_DEFAULT_PORT) {
  if (state.server) {
    return getGatewayStatus();
  }
  state.port = port;
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void onRequest(req, res);
    });
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      state.server = server;
      state.startedAt = Date.now();
      state.unsubscribeEvents = onDomainEvent((event: DomainEvent) => broadcastSse(event));
      startSseHeartbeat();
      publishDomainEvent("gateway-status", getGatewayStatus());
      resolve();
    });
  });
  return getGatewayStatus();
}

export async function stopLocalGateway() {
  if (!state.server) {
    return getGatewayStatus();
  }
  const server = state.server;
  state.server = null;
  state.unsubscribeEvents?.();
  state.unsubscribeEvents = null;
  stopSseHeartbeat();
  for (const client of state.sseClients) {
    try {
      client.res.end();
    } catch {
      // ignore
    }
  }
  state.sseClients.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  state.startedAt = null;
  publishDomainEvent("gateway-status", getGatewayStatus());
  return getGatewayStatus();
}
