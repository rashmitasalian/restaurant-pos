import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import restoNitiMark from "../../ui/assets/restoniti-icon.png";

export function LoginScreen({
  brandingName,
  username,
  password,
  pairingCode,
  setUsername,
  setPassword,
  setPairingCode,
  busy,
  error,
  onLogin,
}: {
  brandingName?: string;
  username: string;
  password: string;
  pairingCode: string;
  setUsername: (v: string) => void;
  setPassword: (v: string) => void;
  setPairingCode: (v: string) => void;
  busy: boolean;
  error?: string | null;
  onLogin: () => void | Promise<void>;
}) {
  const [showPassword, setShowPassword] = React.useState(false);
  const storedPairing = React.useMemo(() => {
    try {
      return Boolean(localStorage.getItem("captain-pairing-code"));
    } catch {
      return false;
    }
  }, []);
  const [editPairing, setEditPairing] = React.useState(!storedPairing || !pairingCode);
  const title = brandingName || "RestoNiti Captain";

  return (
    <div className="cap-login">
      <div className="cap-login-brand">
        <img src={restoNitiMark} alt="" className="cap-login-mark" width={56} height={56} />
        <h1>{title}</h1>
        <p>Captain</p>
      </div>

      <form
        className="cap-login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin();
        }}
      >
        {error ? <div className="cap-error">{error}</div> : null}

        <div className="cap-field">
          <label htmlFor="cap-user">Username</label>
          <input
            id="cap-user"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="cap-field">
          <label htmlFor="cap-pass">Password</label>
          <div className="cap-password-wrap">
            <input
              id="cap-pass"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="cap-password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((open) => !open)}
            >
              <Icon icon={showPassword ? EyeOff : Eye} size="lg" />
            </button>
          </div>
        </div>

        {editPairing ? (
          <div className="cap-field">
            <label htmlFor="cap-pair">POS pairing code</label>
            <input
              id="cap-pair"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              placeholder="Shown on POS"
            />
          </div>
        ) : (
          <div className="cap-paired-row">
            <span>Paired with POS</span>
            <button type="button" className="cap-text-btn" onClick={() => setEditPairing(true)}>
              Change
            </button>
          </div>
        )}

        <button
          type="submit"
          className="cap-btn cap-btn-primary"
          disabled={busy || !username || !password || !pairingCode}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="cap-login-hint">Needs the POS Local Gateway on this Wi-Fi.</p>
    </div>
  );
}
