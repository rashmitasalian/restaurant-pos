import React from "react";
import { recoverLastAdmin } from "../../../app/db/posRepository";
import { PasswordValidator } from "../../../app/utils/validators";
import { ENV } from "../../../config/env";
import { AuthContext } from "../../context/AuthContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import restoNitiMark from "../../assets/restoniti-icon.png";

export default function LoginScreen() {
  const auth = React.useContext(AuthContext);
  const [branding, setBranding] = React.useState<{
    hotelName?: string;
    hotelInitials?: string;
    tagline?: string;
    logoDataUrl?: string | null;
  } | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [lockedSeconds, setLockedSeconds] = React.useState(0);
  const [showRecovery, setShowRecovery] = React.useState(false);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    let alive = true;
    window.pos?.branding
      ?.getPublic()
      .then((cfg) => {
        if (alive) {
          setBranding(cfg || null);
        }
      })
      .catch(() => {
        if (alive) {
          setBranding(null);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (lockedSeconds <= 0) {
      return;
    }
    const id = setTimeout(() => setLockedSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [lockedSeconds]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || lockedSeconds > 0 || !auth) {
      return;
    }
    setError(null);

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await auth.login(username.trim(), password);
      if (!result.ok) {
        if (result.reason === "locked") {
          setLockedSeconds(result.lockedSeconds ?? 30);
          setError(null);
        } else if (result.reason === "inactive") {
          setError("This account has been disabled. Please contact your administrator.");
        } else {
          setError("Invalid username or password.");
        }
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const isLocked = lockedSeconds > 0;
  const disabled = isSubmitting || isLocked || !username || !password;
  const restaurantName = (branding?.hotelName || ENV.HOTEL_NAME || "").trim();
  const hasRestaurantIdentity = Boolean(branding?.logoDataUrl || restaurantName);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100%",
        background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)",
        padding: "20px",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "32px 24px",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          background: "#fff",
        }}
      >
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src={restoNitiMark}
              alt=""
              style={{ width: 54, height: 54, borderRadius: 14, display: "block" }}
            />
            <div>
              <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: -0.7 }}>
                <span style={{ color: "#111827" }}>Resto</span>
                <span style={{ color: "#f59e0b" }}>Niti</span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, fontWeight: 600 }}>
                Billing, tables, reports & operations
              </div>
            </div>
          </div>
          {hasRestaurantIdentity && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 18,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
              }}
            >
              {branding?.logoDataUrl && (
                <img
                  src={branding.logoDataUrl}
                  alt=""
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    objectFit: "contain",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    padding: 3,
                    flexShrink: 0,
                  }}
                />
              )}
              <div>
                {restaurantName && (
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>
                    {restaurantName}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Staff sign-in</div>
              </div>
            </div>
          )}
          {!hasRestaurantIdentity && (
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700, marginTop: 16 }}>
              Staff sign-in
            </div>
          )}
        </div>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={labelStyle}>Username</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(event) => setUsername(event.target.value)}
            disabled={isSubmitting || isLocked}
            style={inputStyle(isLocked)}
          />
        </label>

        <label style={{ display: "block", marginBottom: 20 }}>
          <span style={labelStyle}>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting || isLocked}
            style={inputStyle(isLocked)}
          />
        </label>

        {error && <Message tone="error">{error}</Message>}

        {isLocked && (
          <Message tone="warning">
            Too many failed attempts. Try again in <strong>{lockedSeconds}s</strong>.
          </Message>
        )}

        <button
          type="submit"
          disabled={disabled}
          style={{
            width: "100%",
            padding: "11px 0",
            background: disabled ? "#e5e7eb" : "#d97706",
            color: disabled ? "#9ca3af" : "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 15,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "Signing in..." : isLocked ? `Locked (${lockedSeconds}s)` : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => setShowRecovery(true)}
          disabled={isSubmitting}
          style={{
            width: "100%",
            marginTop: 14,
            border: "none",
            background: "transparent",
            color: "#92400e",
            fontSize: 13,
            fontWeight: 700,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting ? 0.6 : 1,
            padding: 6,
          }}
        >
          Forgot admin password?
        </button>
      </form>

      {showRecovery && (
        <RecoveryModal
          initialUsername={username.trim().toLowerCase()}
          onClose={() => setShowRecovery(false)}
        />
      )}
    </div>
  );
}

function RecoveryModal({
  initialUsername,
  onClose,
}: {
  initialUsername: string;
  onClose: () => void;
}) {
  const [username, setUsername] = React.useState(initialUsername);
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [lockedSeconds, setLockedSeconds] = React.useState(0);
  const submittingRef = React.useRef(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, isSubmitting ? undefined : onClose);
  const passwordErrors = newPassword ? PasswordValidator.validate(newPassword).errors : [];

  React.useEffect(() => {
    if (lockedSeconds <= 0) {
      return;
    }
    const id = setTimeout(() => setLockedSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [lockedSeconds]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || lockedSeconds > 0) {
      return;
    }
    setError(null);

    const uname = username.trim().toLowerCase();
    if (!uname) {
      setError("Username is required.");
      return;
    }
    if (!recoveryCode.trim()) {
      setError("Recovery code is required.");
      return;
    }
    const validation = PasswordValidator.validate(newPassword);
    if (!validation.ok) {
      setError(validation.errors[0] || "Password does not meet requirements.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await recoverLastAdmin({
        username: uname,
        recoveryCode,
        newPassword,
      });
      if (result.ok) {
        setSuccess(true);
        setRecoveryCode("");
        setNewPassword("");
        setConfirmPassword("");
      } else if (result.reason === "locked") {
        setLockedSeconds(result.lockedSeconds ?? 30);
        setError(null);
      } else {
        setError("Recovery failed. Check the username and recovery code.");
      }
    } catch {
      setError("Recovery failed. Check the username and recovery code.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={isSubmitting ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recoveryDialogTitle"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 8px 40px rgba(0,0,0,0.16)",
        }}
      >
        <h3 id="recoveryDialogTitle" style={{ margin: "0 0 8px", fontSize: 17, color: "#111827" }}>
          Recover admin access
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.5, color: "#6b7280" }}>
          Recovery works only for the single last active admin account and requires an unused
          one-time recovery code.
        </p>

        {success ? (
          <>
            <Message tone="success">
              Password changed. You can sign in with the new password.
            </Message>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" onClick={onClose} style={secondaryButtonStyle}>
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>Admin username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                disabled={isSubmitting || lockedSeconds > 0}
                style={inputStyle(lockedSeconds > 0)}
              />
            </label>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>Recovery code</span>
              <input
                type="text"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoComplete="off"
                disabled={isSubmitting || lockedSeconds > 0}
                style={{ ...inputStyle(lockedSeconds > 0), fontFamily: "monospace" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || lockedSeconds > 0}
                style={inputStyle(lockedSeconds > 0)}
              />
            </label>

            {newPassword && passwordErrors.length > 0 && (
              <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "#dc2626", fontSize: 12 }}>
                {passwordErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}

            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={labelStyle}>Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || lockedSeconds > 0}
                style={inputStyle(lockedSeconds > 0)}
              />
            </label>

            {error && <Message tone="error">{error}</Message>}
            {lockedSeconds > 0 && (
              <Message tone="warning">
                Too many recovery attempts. Try again in <strong>{lockedSeconds}s</strong>.
              </Message>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  lockedSeconds > 0 ||
                  !username ||
                  !recoveryCode ||
                  !newPassword ||
                  !confirmPassword ||
                  passwordErrors.length > 0
                }
                style={primaryButtonStyle}
              >
                {isSubmitting ? "Recovering..." : "Recover access"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Message({
  tone,
  children,
}: {
  tone: "error" | "warning" | "success";
  children: React.ReactNode;
}) {
  const colors = {
    error: { bg: "#fef2f2", border: "#fca5a5", color: "#b91c1c" },
    warning: { bg: "#fffbeb", border: "#fcd34d", color: "#92400e" },
    success: { bg: "#d1fae5", border: "#6ee7b7", color: "#065f46" },
  }[tone];
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.color,
        borderRadius: 6,
        padding: "9px 12px",
        fontSize: 13,
        marginBottom: 16,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#374151",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
};

function inputStyle(disabled = false): React.CSSProperties {
  return {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    background: disabled ? "#f9fafb" : "#fff",
  };
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "#d97706",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
