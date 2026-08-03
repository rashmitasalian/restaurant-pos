import React from "react";
import { ENV } from "../../config/env";
import {
  Session,
  getSession,
  refreshSession,
  login as authLogin,
  changePassword as authChangePassword,
  logout as authLogout,
  LoginReason,
} from "../../app/auth/auth";

export type LoginResult = {
  ok: boolean;
  reason?: LoginReason;
  lockedSeconds?: number;
};

type AuthContextType = {
  session: Session | null;
  /** True while the initial session DB-verification is in progress. */
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  refresh: () => Promise<Session | null>;
  /**
   * Change the current user's password and re-sync session.
   * Clears requirePasswordChange on success.
   */
  changePassword: (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>;
};

export const AuthContext = React.createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = React.useState<Session | null>(() => getSession());
  const [loading, setLoading] = React.useState(true);

  const logStartup = React.useCallback((stage: string, context?: Record<string, unknown>) => {
    const t0 = Number((window as any).__posStartupT0 || 0);
    const elapsedMs =
      Number.isFinite(t0) && t0 > 0 && typeof performance !== "undefined"
        ? Number((performance.now() - t0).toFixed(1))
        : undefined;
    const payload = { elapsedMs, ...(context || {}) };
    console.info(`[renderer-startup] ${stage}`, payload);
    window.pos?.writeLog?.("info", `[renderer-startup] ${stage}`, payload).catch(() => {
      // best effort telemetry
    });
  }, []);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      logStartup("auth-refresh:start");
      const s = await refreshSession();
      if (mounted) {
        setSession(s);
        setLoading(false);
        logStartup("auth-refresh:done", {
          hasSession: Boolean(s),
          requirePasswordChange: Boolean(s?.requirePasswordChange),
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [logStartup]);

  // ── Idle timeout: auto-logout after 30 minutes of inactivity ─────────────
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const IDLE_MS = ENV.SESSION_INACTIVITY_MS;

  const resetIdleTimer = React.useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      authLogout();
      setSession(null);
    }, IDLE_MS);
  }, []);

  React.useEffect(() => {
    if (!session) {
      // No session — clear any pending timer
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      return;
    }
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];
    events.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer(); // start timer on mount / session change
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [session, resetIdleTimer]);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    const res = await authLogin(username, password);
    if (res.ok) {
      // Re-read from DB to get latest role / requirePasswordChange
      const s = await refreshSession();
      setSession(s);
      // Set default tab after login
      window.location.hash = "#tables";
      // If refreshSession returns null after a successful login, the account
      // was disabled in the millisecond between verify and refresh — treat as failure.
      return { ok: Boolean(s) };
    }
    return { ok: false, reason: res.reason, lockedSeconds: res.lockedSeconds };
  };

  const logout = () => {
    authLogout();
    setSession(null);
  };

  const refresh = async () => {
    const s = await refreshSession();
    setSession(s);
    return s;
  };

  const changePassword = async (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!session) {
      return { ok: false, error: "not-logged-in" };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: "passwords-do-not-match" };
    }
    if (!currentPassword) {
      return { ok: false, error: "current-password-required" };
    }
    try {
      const changed = await authChangePassword(session.username, currentPassword, newPassword);
      if (!changed.ok) {
        return changed;
      }
      // Re-sync session to clear requirePasswordChange flag
      const s = await refreshSession();
      setSession(s);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "unknown-error" };
    }
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refresh, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
};
