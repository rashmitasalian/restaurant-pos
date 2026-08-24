import React from "react";
import { AuthContext } from "../../context/AuthContext";
import { PasswordValidator } from "../../../app/utils/validators";
import authStyles from "./Auth.module.css";

export default function ChangePasswordScreen() {
  const auth = React.useContext(AuthContext);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [passwordErrors, setPasswordErrors] = React.useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    if (newPassword) {
      const { errors } = PasswordValidator.validate(newPassword);
      setPasswordErrors(errors);
    } else {
      setPasswordErrors([]);
    }
  }, [newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || submittingRef.current) {
      return;
    }
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const validation = PasswordValidator.validate(newPassword);
    if (!validation.ok) {
      setError(validation.errors[0] || "Password does not meet requirements.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await auth.changePassword(currentPassword, newPassword, confirmPassword);
      if (!result.ok) {
        const messages: Record<string, string> = {
          "passwords-do-not-match": "Passwords do not match.",
          "current-password-required": "Enter your current password.",
          "invalid-current-password": "Current password is incorrect.",
          "user-not-found": "Session error - please log in again.",
          "not-logged-in": "Session expired - please log in again.",
        };
        setError(
          messages[result.error ?? ""] ||
            result.error ||
            "Failed to change password. Please try again.",
        );
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const displayName = auth?.session?.displayName || auth?.session?.username || "User";
  const canSubmit =
    !isSubmitting &&
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    passwordErrors.length === 0;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid var(--pos-line-strong)",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div className={authStyles.screen}>
      <form
        onSubmit={handleSubmit}
        className={authStyles.card}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--pos-teal)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--pos-surface)",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            #
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--pos-tx)" }}>
              Set a new password
            </div>
            <div style={{ fontSize: 12, color: "var(--pos-tx-sub)", marginTop: 2 }}>
              Welcome, {displayName}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "var(--pos-saffron-tint)",
            border: "1px solid var(--pos-saffron-line)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--pos-saffron-text)",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          For security, enter your current or temporary password, then set a new password.
        </div>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--pos-tx-sec)", marginBottom: 6 }}>
            Current password
          </span>
          <input
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={isSubmitting}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--pos-tx-sec)", marginBottom: 6 }}>
            New password
          </span>
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isSubmitting}
            placeholder="Minimum 8 characters"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--pos-tx-sec)", marginBottom: 6 }}>
            Confirm password
          </span>
          <input
            type="password"
            value={confirmPassword}
            autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isSubmitting}
            placeholder="Repeat your new password"
            style={inputStyle}
          />
        </label>

        {newPassword && passwordErrors.length > 0 && (
          <div
            style={{
              background: "var(--pos-surface-sunken)",
              border: "1px solid var(--pos-line)",
              borderRadius: 6,
              padding: "12px 14px",
              fontSize: 12,
              color: "var(--pos-tx-sub)",
              marginBottom: 18,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--pos-tx-sec)", marginBottom: 8 }}>
              Password requirements:
            </div>
            {passwordErrors.map((message) => (
              <div key={message} style={{ marginBottom: 6 }}>
                {message}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div
            style={{
              background: "var(--pos-danger-tint)",
              border: "1px solid var(--pos-danger-line)",
              color: "var(--pos-danger-strong)",
              borderRadius: 6,
              padding: "9px 12px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "11px 0",
            background: canSubmit ? "var(--pos-saffron-deep)" : "var(--pos-line)",
            color: canSubmit ? "var(--pos-surface)" : "var(--pos-tx-muted)",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 15,
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "background 120ms",
          }}
        >
          {isSubmitting ? "Saving..." : "Set password & continue"}
        </button>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button
            type="button"
            onClick={() => auth?.logout()}
            disabled={isSubmitting}
            style={{
              background: "none",
              border: "none",
              color: "var(--pos-tx-sub)",
              fontSize: 12,
              cursor: isSubmitting ? "not-allowed" : "pointer",
              opacity: isSubmitting ? 0.6 : 1,
              textDecoration: "underline",
            }}
          >
            Sign out and use a different account
          </button>
        </div>
      </form>
    </div>
  );
}
