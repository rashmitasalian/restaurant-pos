const DEVICE_KEY = "captain-device-id";
const SESSION_KEY = "captain-session-token";
const USER_KEY = "captain-user";
const REQUEST_TIMEOUT_MS = 20_000;
const SSE_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export type CaptainUser = {
  username: string;
  role: string;
  displayName?: string;
  deviceId?: string;
};

function apiBase() {
  const fromEnv = String((import.meta as any).env?.VITE_GATEWAY_URL || "").replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  return "";
}

function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) {
      return existing;
    }
    const next = `device:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return `device:temp`;
  }
}

export function getDeviceId() {
  return deviceId();
}

export function getStoredSession() {
  try {
    return {
      token: localStorage.getItem(SESSION_KEY),
      user: JSON.parse(localStorage.getItem(USER_KEY) || "null") as CaptainUser | null,
    };
  } catch {
    return { token: null, user: null };
  }
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
}

function storeSession(token: string, user: CaptainUser) {
  localStorage.setItem(SESSION_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function isAbortError(err: unknown) {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    String((err as any)?.name || "") === "AbortError"
  );
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
    clientOpId?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Device-Id": deviceId(),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.clientOpId) {
    headers["X-Client-Op-Id"] = options.clientOpId;
  }
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String((data as any)?.error || `http-${res.status}`));
    }
    return data as T;
  } catch (err: any) {
    if (isAbortError(err)) {
      throw new Error("request-timeout");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export function newClientOpId(prefix: string) {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function nextSseBackoffMs(attempt: number) {
  const index = Math.max(0, Math.min(SSE_BACKOFF_MS.length - 1, attempt - 1));
  return SSE_BACKOFF_MS[index];
}

export const captainApi = {
  health: async () => {
    const data = await request<{ ok: boolean }>("/api/health", { timeoutMs: 8000 });
    if (!data?.ok) {
      throw new Error("pos-unavailable");
    }
    return data;
  },
  branding: () =>
    request<{ hotelName?: string; tagline?: string }>("/api/branding", { timeoutMs: 8000 }),
  login: async (username: string, password: string, pairingCode: string) => {
    const result = await request<{
      ok: boolean;
      sessionToken: string;
      user: CaptainUser;
    }>("/api/auth/login", {
      method: "POST",
      body: { username, password, pairingCode, deviceId: deviceId() },
    });
    storeSession(result.sessionToken, result.user);
    return result;
  },
  logout: (token: string) =>
    request("/api/auth/logout", { method: "POST", token, timeoutMs: 8000 }).finally(
      clearStoredSession,
    ),
  tables: (token: string) => request<any>("/api/tables", { token }),
  kots: (token: string) =>
    request<{
      tickets: Array<{
        orderId: string;
        tableId: number;
        tableName: string;
        kotStatus: string;
        lastSendAt: number | null;
        sentSummary: string;
        sentCount: number;
        unsentCount: number;
      }>;
    }>("/api/kots", { token }),
  menu: (token: string) => request<{ items: any[]; categories: string[] }>("/api/menu", { token }),
  openTable: (token: string, tableId: number, clientOpId: string) =>
    request<any>("/api/orders/open-table", {
      method: "POST",
      token,
      clientOpId,
      body: { tableId, clientOpId },
    }),
  getOrder: (token: string, orderId: string) =>
    request<any>(`/api/orders/${encodeURIComponent(orderId)}`, { token }),
  addItem: (
    token: string,
    orderId: string,
    item: {
      name: string;
      qty: number;
      rate: number;
      menuItemId?: string;
      categoryName?: string;
      baseUpdatedAt?: number | null;
    },
    clientOpId: string,
  ) =>
    request<any>(`/api/orders/${encodeURIComponent(orderId)}/items`, {
      method: "POST",
      token,
      clientOpId,
      body: { ...item, clientOpId },
    }),
  updateLines: (
    token: string,
    orderId: string,
    lines: any[],
    clientOpId: string,
    baseUpdatedAt?: number | null,
  ) =>
    request<any>(`/api/orders/${encodeURIComponent(orderId)}/lines`, {
      method: "PUT",
      token,
      clientOpId,
      body: { lines, clientOpId, baseUpdatedAt },
    }),
  sendKot: (token: string, orderId: string, clientOpId: string, baseUpdatedAt?: number | null) =>
    request<any>(`/api/orders/${encodeURIComponent(orderId)}/send-kot`, {
      method: "POST",
      token,
      clientOpId,
      body: { clientOpId, baseUpdatedAt },
    }),
  voidItem: (
    token: string,
    orderId: string,
    payload: {
      lineId: string;
      finalQty: number;
      reason: string;
      baseUpdatedAt?: number | null;
    },
    clientOpId: string,
  ) =>
    request<any>(`/api/orders/${encodeURIComponent(orderId)}/void-item`, {
      method: "POST",
      token,
      clientOpId,
      body: { ...payload, clientOpId },
    }),
  openEvents: (
    token: string,
    onEvent: (event: any) => void,
    opts: {
      onError?: (err: { message: string; status?: number }) => void;
    } = {},
  ) => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/events`, {
          headers: { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId() },
          signal: controller.signal,
        });
        if (!res.body || !res.ok) {
          const status = res.status;
          const message = status === 401 ? "auth-required" : `sse-failed-${status || "?"}`;
          throw { message, status };
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
              onEvent(JSON.parse(dataLine.slice(5).trim()));
            } catch {
              // ignore malformed
            }
          }
        }
        if (!controller.signal.aborted) {
          opts.onError?.({ message: "sse-ended" });
        }
      } catch (err: any) {
        if (controller.signal.aborted) {
          return;
        }
        const message = String(err?.message || err || "sse-failed");
        opts.onError?.({ message, status: Number(err?.status) || undefined });
      }
    })();
    return () => controller.abort();
  },
};
