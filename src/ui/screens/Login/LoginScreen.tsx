import React from "react";
import { recoverLastAdmin } from "../../../app/db/posRepository";
import { PasswordValidator } from "../../../app/utils/validators";
import { ENV } from "../../../config/env";
import { AuthContext } from "../../context/AuthContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import restoNitiMark from "../../assets/restoniti-icon.png";
import { Button } from "../../components/ui/Button";
import { Eye, EyeOff } from "lucide-react";
import authStyles from "./Auth.module.css";

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
  const [showPassword, setShowPassword] = React.useState(false);
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

    if (!username.trim() || !password) {
      setError("Enter username and password.");
      return;
    }

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
        } else if (result.reason === "captain-phone-only") {
          setError("Captain accounts sign in on the phone app, not this POS.");
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
  // Keep Sign in visually authoritative; only block while submitting or locked.
  const disabled = isSubmitting || isLocked;
  const restaurantName = (branding?.hotelName || ENV.HOTEL_NAME || "").trim();
  const hasRestaurantIdentity = Boolean(branding?.logoDataUrl || restaurantName);

  return (
    <div className={authStyles.screen}>
      <div className={authStyles.shell}>
        <aside className={authStyles.brandPane} aria-hidden="true">
          <div className={authStyles.brandPaneTop}>
            <img src={restoNitiMark} alt="" className={authStyles.brandMark} />
            <div>
              <div className={authStyles.brandName}>
                <span className={authStyles.brandResto}>Resto</span>
                <span className={authStyles.brandNiti}>Niti</span>
              </div>
              <p className={authStyles.brandTagline}>
                Built for the restaurant floor.
              </p>
              <ul className={authStyles.brandCapabilities}>
                <li>Billing</li>
                <li>KOT &amp; printing</li>
                <li>Reports &amp; operations</li>
              </ul>
            </div>
          </div>
          <div className={authStyles.brandPaneFoot} aria-hidden="true">
            <span>Offline-ready</span>
            <span className={authStyles.brandPaneFootDot} aria-hidden="true" />
            <span>Secure</span>
            <span className={authStyles.brandPaneFootDot} aria-hidden="true" />
            <span>Built for restaurants</span>
          </div>
        </aside>

        <form onSubmit={handleSubmit} className={authStyles.formPane}>
          <div className={authStyles.formHeader}>
            <h1 className={authStyles.formTitle}>Sign in</h1>
            <p className={authStyles.formSubtitle}>Enter your staff credentials to continue</p>
          </div>

          {hasRestaurantIdentity ? (
            <div className={authStyles.hotelRow}>
              {branding?.logoDataUrl ? (
                <img src={branding.logoDataUrl} alt="" className={authStyles.hotelLogo} />
              ) : null}
              <div style={{ minWidth: 0 }}>
                {restaurantName ? <div className={authStyles.hotelName}>{restaurantName}</div> : null}
                <div className={authStyles.hotelMeta}>Restaurant staff access</div>
              </div>
            </div>
          ) : (
            <div className={authStyles.hotelMeta} style={{ marginBottom: 16 }}>
              Restaurant staff access
            </div>
          )}

          <label className={authStyles.field}>
            <span className={authStyles.fieldLabel}>Username</span>
            <input
              type="text"
              value={username}
              autoComplete="username"
              autoFocus
              onChange={(event) => setUsername(event.target.value)}
              disabled={isSubmitting || isLocked}
              className={authStyles.input}
            />
          </label>

          <label className={authStyles.field}>
            <span className={authStyles.fieldLabel}>Password</span>
            <div className={authStyles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting || isLocked}
                className={`${authStyles.input} ${authStyles.passwordInput}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isSubmitting || isLocked}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
                className={authStyles.passwordToggle}
              >
                {showPassword ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
              </button>
            </div>
          </label>

          {error ? <Message tone="error">{error}</Message> : null}

          {isLocked ? (
            <Message tone="warning">
              Too many failed attempts. Try again in <strong>{lockedSeconds}s</strong>.
            </Message>
          ) : null}

          <button type="submit" disabled={disabled} className={authStyles.submitBtn}>
            {isSubmitting ? "Signing in..." : isLocked ? `Locked (${lockedSeconds}s)` : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => setShowRecovery(true)}
            disabled={isSubmitting}
            className={authStyles.linkBtn}
          >
            Need help signing in?
          </button>
        </form>
      </div>

      {showRecovery ? (
        <RecoveryModal
          initialUsername={username.trim().toLowerCase()}
          onClose={() => setShowRecovery(false)}
        />
      ) : null}
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
    <div onClick={isSubmitting ? undefined : onClose} className={authStyles.overlay}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recoveryDialogTitle"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={authStyles.overlayCard}
      >
        <h3 id="recoveryDialogTitle" style={{ margin: "0 0 8px", fontSize: 17, color: "var(--pos-tx)" }}>
          Recover admin access
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.5, color: "var(--pos-tx-sub)" }}>
          Recovery works only for the single last active admin account and requires an unused one-time
          recovery code.
        </p>

        {success ? (
          <>
            <Message tone="success">Password changed. You can sign in with the new password.</Message>
            <div className={authStyles.overlayActions}>
              <Button type="button" size="sm" variant="secondary" onClick={onClose}>
                Back to sign in
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Admin username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                disabled={isSubmitting || lockedSeconds > 0}
                className={authStyles.input}
              />
            </label>

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Recovery code</span>
              <input
                type="text"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoComplete="off"
                disabled={isSubmitting || lockedSeconds > 0}
                className={`${authStyles.input} ${authStyles.inputMono}`}
              />
            </label>

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || lockedSeconds > 0}
                className={authStyles.input}
              />
            </label>

            {newPassword && passwordErrors.length > 0 ? (
              <ul className={authStyles.errorList}>
                {passwordErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}

            <label className={authStyles.field}>
              <span className={authStyles.fieldLabel}>Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isSubmitting || lockedSeconds > 0}
                className={authStyles.input}
              />
            </label>

            {error ? <Message tone="error">{error}</Message> : null}
            {lockedSeconds > 0 ? (
              <Message tone="warning">
                Too many recovery attempts. Try again in <strong>{lockedSeconds}s</strong>.
              </Message>
            ) : null}

            <div className={authStyles.overlayActions}>
              <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={
                  isSubmitting ||
                  lockedSeconds > 0 ||
                  !username ||
                  !recoveryCode ||
                  !newPassword ||
                  !confirmPassword ||
                  passwordErrors.length > 0
                }
              >
                {isSubmitting ? "Recovering..." : "Recover access"}
              </Button>
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
  const toneClass =
    tone === "error"
      ? authStyles.messageError
      : tone === "warning"
        ? authStyles.messageWarning
        : authStyles.messageSuccess;
  return <div className={`${authStyles.message} ${toneClass}`}>{children}</div>;
}
