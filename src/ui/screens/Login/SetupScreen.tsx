import React from "react";
import { createFirstAdmin } from "../../../app/db/posRepository";
import { PasswordValidator } from "../../../app/utils/validators";
import { ENV } from "../../../config/env";
import { RECOVERY_CODE_COUNT } from "../../../shared/auth";
import { isValidPersonName, normalizeText, validationMessage } from "../../../shared/validation";
import restoNitiMark from "../../assets/restoniti-icon.png";

export default function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = React.useState("admin");
  const [displayName, setDisplayName] = React.useState("Administrator");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [passwordErrors, setPasswordErrors] = React.useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [savedCodes, setSavedCodes] = React.useState(false);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    setPasswordErrors(password ? PasswordValidator.validate(password).errors : []);
  }, [password]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    setError(null);

    const uname = username.trim().toLowerCase();
    if (!uname || uname.length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const display = normalizeText(displayName) || uname;
    if (normalizeText(displayName) && !isValidPersonName(display)) {
      setError(validationMessage("display-name-invalid"));
      return;
    }

    const validation = PasswordValidator.validate(password);
    if (!validation.ok) {
      setError(validation.errors[0] || "Password does not meet requirements.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await createFirstAdmin({
        username: uname,
        password,
        displayName: display,
      });
      setRecoveryCodes(result.recoveryCodes);
    } catch (err: any) {
      const message =
        err?.message === "setup-already-complete"
          ? "Setup is already complete. Please sign in."
          : err?.message || "Failed to create admin account.";
      setError(message);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const allValid =
    password.length > 0 && passwordErrors.length === 0 && password === confirmPassword;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100%",
        background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 500,
          padding: "36px 28px",
          borderRadius: 14,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <img
            src={restoNitiMark}
            alt="RestoNiti"
            style={{ width: 44, height: 44, borderRadius: 12, display: "block", flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>
              {ENV.APP_NAME || (
                <>
                  <span style={{ color: "#111827" }}>Resto</span>
                  <span style={{ color: "#f59e0b" }}>Niti</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>First-time setup</div>
          </div>
        </div>

        {recoveryCodes ? (
          <RecoveryCodesStep
            recoveryCodes={recoveryCodes}
            savedCodes={savedCodes}
            setSavedCodes={setSavedCodes}
            onComplete={onComplete}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "12px 0 24px", lineHeight: 1.5 }}>
              No accounts exist yet. Create the owner administrator account. The next step will show{" "}
              {RECOVERY_CODE_COUNT} one-time recovery codes for offline password recovery.
            </p>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                disabled={isSubmitting}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>Display Name</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={isSubmitting}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={labelStyle}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting}
                style={inputStyle}
              />
            </label>

            {password.length > 0 && passwordErrors.length > 0 && (
              <ul
                style={{
                  margin: "0 0 14px",
                  padding: "0 0 0 18px",
                  fontSize: 12,
                  color: "#dc2626",
                  lineHeight: 1.7,
                }}
              >
                {passwordErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}

            <label style={{ display: "block", marginBottom: 20 }}>
              <span style={labelStyle}>Confirm Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting}
                style={inputStyle}
              />
              {confirmPassword && password !== confirmPassword && (
                <span style={{ fontSize: 12, color: "#dc2626", marginTop: 4, display: "block" }}>
                  Passwords do not match
                </span>
              )}
            </label>

            {error && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#fef2f2",
                  color: "#dc2626",
                  fontSize: 13,
                  marginBottom: 16,
                  border: "1px solid #fecaca",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !allValid}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 9,
                border: "none",
                background: allValid ? "linear-gradient(135deg, #059669, #34d399)" : "#d1d5db",
                color: allValid ? "#fff" : "#9ca3af",
                fontWeight: 800,
                fontSize: 15,
                cursor: allValid ? "pointer" : "not-allowed",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Creating account..." : "Create Admin Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function RecoveryCodesStep({
  recoveryCodes,
  savedCodes,
  setSavedCodes,
  onComplete,
}: {
  recoveryCodes: string[];
  savedCodes: boolean;
  setSavedCodes: (value: boolean) => void;
  onComplete: () => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "12px 0 18px", lineHeight: 1.5 }}>
        Save these {RECOVERY_CODE_COUNT} recovery codes now. They are shown only once and each code
        can be used one time to recover the last active admin account.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
          padding: 14,
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        {recoveryCodes.map((code) => (
          <code
            key={code}
            style={{
              padding: "8px 10px",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 7,
              fontSize: 13,
              color: "#111827",
              textAlign: "center",
              userSelect: "text",
            }}
          >
            {code}
          </code>
        ))}
      </div>

      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          background: "#fffbeb",
          border: "1px solid #fcd34d",
          color: "#92400e",
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        Store these codes somewhere offline and private. The app stores only salted hashes, so the
        codes cannot be viewed again later.
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 13,
          color: "#374151",
          marginBottom: 18,
          lineHeight: 1.4,
        }}
      >
        <input
          type="checkbox"
          checked={savedCodes}
          onChange={(event) => setSavedCodes(event.target.checked)}
          style={{ marginTop: 2 }}
        />
        I have saved these recovery codes in a secure place.
      </label>

      <button
        type="button"
        onClick={onComplete}
        disabled={!savedCodes}
        style={{
          width: "100%",
          padding: "12px 0",
          borderRadius: 9,
          border: "none",
          background: savedCodes ? "linear-gradient(135deg, #059669, #34d399)" : "#d1d5db",
          color: savedCodes ? "#fff" : "#9ca3af",
          fontWeight: 800,
          fontSize: 15,
          cursor: savedCodes ? "pointer" : "not-allowed",
        }}
      >
        Continue to Login
      </button>
    </div>
  );
}
