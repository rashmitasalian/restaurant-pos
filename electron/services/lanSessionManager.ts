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

export function countLanSessions() {
  const now = Date.now();
  let count = 0;
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    } else {
      count += 1;
    }
  }
  return count;
}
