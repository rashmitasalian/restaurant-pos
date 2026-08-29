import React from "react";
import { createFirstAdmin } from "../../../app/db/posRepository";
import { PasswordValidator } from "../../../app/utils/validators";
import { ENV } from "../../../config/env";
import { RECOVERY_CODE_COUNT } from "../../../shared/auth";
import { isValidPersonName, normalizeText, validationMessage } from "../../../shared/validation";
import restoNitiMark from "../../assets/restoniti-icon.png";
import authStyles from "./Auth.module.css";

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

  return (
    <div className={authStyles.screen}>
      <div className={`${authStyles.card} ${authStyles.cardWide}`}>
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
                  <span className={authStyles.brandResto}>Resto</span>
                  <span className={authStyles.brandNiti}>Niti</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--pos-tx-sub)", marginTop: 2 }}>First-time setup</div>
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
            <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", margin: "12px 0 24px", lineHeight: 1.5 }}>
              No accounts exist yet. Create the owner administrator account. The next step will show{" "}
              {RECOVERY_CODE_COUNT} one-time recovery codes for offline password recovery.
            </p>

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Username</span>
              <input
                type="text"
                className={authStyles.input}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                disabled={isSubmitting}
              />
            </label>

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Display Name</span>
              <input
                type="text"
                className={authStyles.input}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={isSubmitting}
              />
            </label>

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Password</span>
              <input
                type="password"
                className={authStyles.input}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting}
              />
            </label>

            {password.length > 0 && passwordErrors.length > 0 && (
              <ul className={authStyles.errorList}>
                {passwordErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Confirm Password</span>
              <input
                type="password"
                className={authStyles.input}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting}
              />
              {confirmPassword && password !== confirmPassword && (
                <span style={{ fontSize: 12, color: "var(--pos-danger)", marginTop: 4, display: "block" }}>
                  Passwords do not match
                </span>
              )}
            </label>

            {error && <div className={`${authStyles.message} ${authStyles.messageError}`}>{error}</div>}

            <button
              type="submit"
              className={authStyles.submitBtn}
              disabled={isSubmitting || !allValid}
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
      <p style={{ fontSize: 13, color: "var(--pos-tx-sub)", margin: "12px 0 18px", lineHeight: 1.5 }}>
        Save these {RECOVERY_CODE_COUNT} recovery codes now. They are shown only once and each code
        can be used one time to recover the last active admin account.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
          padding: 14,
          background: "var(--pos-surface-hover)",
          border: "1px solid var(--pos-line)",
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        {recoveryCodes.map((code) => (
          <code
            key={code}
            style={{
              padding: "8px 10px",
              background: "var(--pos-surface)",
              border: "1px solid var(--pos-line)",
              borderRadius: 7,
              fontSize: 13,
              color: "var(--pos-tx)",
              textAlign: "center",
              userSelect: "text",
            }}
          >
            {code}
          </code>
        ))}
      </div>

      <div className={`${authStyles.message} ${authStyles.messageWarning}`}>
        Store these codes somewhere offline and private. The app stores only salted hashes, so the
        codes cannot be viewed again later.
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 13,
          color: "var(--pos-tx-sec)",
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
        className={authStyles.submitBtn}
        onClick={onComplete}
        disabled={!savedCodes}
      >
        Continue to Login
      </button>
    </div>
  );
}
