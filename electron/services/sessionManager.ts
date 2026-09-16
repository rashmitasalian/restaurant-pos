import "../env";
import { randomBytes } from "crypto";
import type { Role, UserDto } from "../../src/shared/pos";

const SESSION_TTL_MS = Number(process.env.VITE_SESSION_INACTIVITY_MS || 1_800_000);

export type MainSession = {
  token: string;
  webContentsId: number;
  username: string;
  role: Role;
  displayName?: string;
  requirePasswordChange?: boolean;
  expiresAt: number;
};

const sessions = new Map<string, MainSession>();

function sessionFromUser(
  token: string,
  webContentsId: number,
  user: Pick<UserDto, "username" | "role" | "displayName" | "requirePasswordChange">,
): MainSession {
  return {
    token,
    webContentsId,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    requirePasswordChange: user.requirePasswordChange,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

export function createMainSession(
  webContentsId: number,
  user: Pick<UserDto, "username" | "role" | "displayName" | "requirePasswordChange">,
) {
  const token = randomBytes(32).toString("base64url");
  const session = sessionFromUser(token, webContentsId, user);
  sessions.set(token, session);
  return session;
}

export function getMainSession(token: string | null | undefined, webContentsId: number) {
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session || session.webContentsId !== webContentsId) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function refreshMainSession(
  token: string,
  user: Pick<UserDto, "username" | "role" | "displayName" | "requirePasswordChange">,
) {
  const current = sessions.get(token);
  if (!current) {
    return null;
  }
  const refreshed = sessionFromUser(token, current.webContentsId, user);
  sessions.set(token, refreshed);
  return refreshed;
}

export function destroyMainSession(token: string | null | undefined) {
  if (token) {
    sessions.delete(token);
  }
}

export function destroySessionsForUser(username: string, exceptToken?: string | null) {
  const key = username.trim().toLowerCase();
  for (const [token, session] of sessions.entries()) {
    if (session.username === key && token !== exceptToken) {
      sessions.delete(token);
    }
  }
}
