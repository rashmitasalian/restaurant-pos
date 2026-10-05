import { randomBytes } from "crypto";
import type { Role } from "../../src/shared/pos";

const SESSION_TTL_MS = Number(process.env.VITE_SESSION_INACTIVITY_MS || 1_800_000);

export type LanSession = {
  token: string;
  username: string;
  role: Role;
  displayName?: string;
  deviceId: string;
  expiresAt: number;
};

const sessions = new Map<string, LanSession>();

export function createLanSession(
  user: Pick<
    { username: string; role: Role; displayName?: string },
    "username" | "role" | "displayName"
  >,
  deviceId?: string | null,
) {
  const token = randomBytes(32).toString("base64url");
  const session: LanSession = {
    token,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    deviceId: String(deviceId || `device:${randomBytes(8).toString("hex")}`),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(token, session);
  return session;
}

export function getLanSession(token: string | null | undefined) {
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

export function destroyLanSession(token: string | null | undefined) {
  if (token) {
    sessions.delete(token);
  }
}

/** Ends every phone signed in as this user. Desktop sessions are a separate store. */
export function destroyLanSessionsForUser(username: string) {
  const key = username.trim().toLowerCase();
  let removed = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.username.trim().toLowerCase() === key) {
      sessions.delete(token);
      removed += 1;
    }
  }
  return removed;
}

export function listLanSessions() {
  const now = Date.now();
  const phones: Array<{ username: string; displayName: string; deviceLabel: string }> = [];
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      continue;
    }
    const device = String(session.deviceId || "");
    phones.push({
      username: session.username,
      displayName: session.displayName || session.username,
      deviceLabel: device ? device.slice(-6).toUpperCase() : "",
    });
  }
  return phones;
}

export function countLanSessions() {
  return listLanSessions().length;
}
