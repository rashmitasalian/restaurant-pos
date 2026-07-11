import React from "react";
import { AuthContext } from "../../context/AuthContext";
import { PasswordValidator } from "../../../app/utils/validators";

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
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 420,
          padding: 32,
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #b45309, #f59e0b)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            #
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>
              Set a new password
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              Welcome, {displayName}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "#92400e",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          For security, enter your current or temporary password, then set a new password.
        </div>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "12px 14px",
              fontSize: 12,
              color: "#6b7280",
              marginBottom: 18,
            }}
          >
            <div style={{ fontWeight: 600, color: "#374151", marginBottom: 8 }}>
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
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#b91c1c",
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
            background: canSubmit ? "#d97706" : "#e5e7eb",
            color: canSubmit ? "#fff" : "#9ca3af",
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
              color: "#6b7280",
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
