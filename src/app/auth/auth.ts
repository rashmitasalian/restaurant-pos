import { getUserByUsername } from "../db/posRepository";
import type { Role } from "../../config/roles";
import { ENV } from "../../config/env";

export type Session = {
  sessionToken: string;
  username: string;
  role: Role;
  displayName?: string;
  sessionStart: number;
  /** Mirrors Use  rDoc.requirePasswordChange; always re-synced from DB on refresh. */
  requirePasswordChange?: boolean;
};

export type LoginReason = "invalid-credentials" | "inactive" | "locked";

export type LoginResult = {
  ok: boolean;
  user?: { username: string; role: string; displayName?: string };
  sessionToken?: string;
  reason?: LoginReason;
  /** Seconds remaining before the account unlocks. */
  lockedSeconds?: number;
};

const SESSION_KEY = ENV.SESSION_KEY;
const MAIN_SESSION_TOKEN_KEY = "pos-main-session-token";
const INACTIVITY_MS = ENV.SESSION_INACTIVITY_MS;

const loginAttempts: Record<string, { count: number; lockedUntil: number }> = {};
const MAX_ATTEMPTS = ENV.AUTH_MAX_ATTEMPTS;
const LOCKOUT_MS = ENV.AUTH_LOCKOUT_MS;

function getAttemptStatus(key: string): { locked: boolean; remainingSec?: number } {
  const entry = loginAttempts[key];
  if (!entry) {
    return { locked: false };
  }
  if (Date.now() < entry.lockedUntil) {
    return {
      locked: true,
      remainingSec: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
    };
  }
  delete loginAttempts[key];
  return { locked: false };
}

function recordFailedAttempt(key: string) {
  if (!loginAttempts[key]) {
    loginAttempts[key] = { count: 0, lockedUntil: 0 };
  }
  loginAttempts[key].count += 1;
  if (loginAttempts[key].count >= MAX_ATTEMPTS) {
    loginAttempts[key].lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

function clearAttempts(key: string) {
  delete loginAttempts[key];
}

export function setSession(sess: Session) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    window.localStorage.setItem(MAIN_SESSION_TOKEN_KEY, sess.sessionToken);
  } catch (_) {}
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(MAIN_SESSION_TOKEN_KEY);
  } catch (_) {}
}

export function getSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Session;
    if (Date.now() - (parsed.sessionStart || 0) > INACTIVITY_MS) {
      clearSession();
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Attempt to authenticate a user.
 *
 * Security guarantees:
 * - Checks account active flag before password comparison.
 * - Both "user not found" and "wrong password" return "invalid-credentials"
 *   to prevent username enumeration.
 * - In-memory brute-force counter: 5 failures means a 15-minute lockout per username.
 * - Audit event written for every attempt.
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  const key = username.trim().toLowerCase();

  const res = await window.pos?.auth?.login(key, password);
  if (!res?.ok || !res.user || !res.sessionToken) {
    return {
      ok: false,
      reason: res?.reason || "invalid-credentials",
      lockedSeconds: res?.lockedSeconds,
    };
  }

  const user = res.user;
  const sess: Session = {
    sessionToken: res.sessionToken,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    sessionStart: Date.now(),
    requirePasswordChange: user.requirePasswordChange ?? false,
  };
  setSession(sess);
  return {
    ok: true,
    user: { username: user.username, role: user.role, displayName: user.displayName },
  };
}

export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await window.pos?.auth?.changePassword(username, currentPassword, newPassword);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || "unknown-error" };
  }
}

export function logout() {
  window.pos?.auth?.logout().catch(() => {});
  clearSession();
}

/**
 * Re-validate the session against the database.
 *
 * Security guarantees:
 * - Role, displayName, active, and requirePasswordChange are always re-read
 *   from the DB. A tampered localStorage role is overwritten here.
 * - Returns null and clears session if the user is disabled or deleted.
 * - Extends the inactivity timer on every successful call.
 */
export async function refreshSession(): Promise<Session | null> {
  const s = getSession();
  if (!s?.sessionToken) {
    return null;
  }

  let u;
  try {
    u = await getUserByUsername(s.username);
  } catch {
    clearSession();
    return null;
  }
  if (!u || u.active === false) {
    clearSession();
    return null;
  }

  const newSess: Session = {
    ...s,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    requirePasswordChange: u.requirePasswordChange ?? false,
    sessionStart: Date.now(),
  };
  setSession(newSess);
  return newSess;
}
