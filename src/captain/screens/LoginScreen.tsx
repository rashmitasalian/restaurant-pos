import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import restoNitiMark from "../../ui/assets/restoniti-icon.png";
import { connectionLabel, type ConnectionState } from "../copy";

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
  connection,
  pairingNeeds,
  linkPaired,
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
  connection: ConnectionState;
  pairingNeeds: boolean;
  linkPaired?: boolean;
  onLogin: () => void | Promise<void>;
}) {
  const [showPassword, setShowPassword] = React.useState(false);
  const [editPairing, setEditPairing] = React.useState(pairingNeeds || !pairingCode);
  const [copied, setCopied] = React.useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const live = connection === "live";

  React.useEffect(() => {
    if (pairingNeeds) {
      setEditPairing(true);
    }
  }, [pairingNeeds]);

  React.useEffect(() => {
    if (linkPaired && pairingCode && !pairingNeeds) {
      setEditPairing(false);
    }
  }, [linkPaired, pairingCode, pairingNeeds]);

  return (
    <div className="cap-login">
      <div className="cap-login-brand">
        <img src={restoNitiMark} alt="" className="cap-login-mark" width={56} height={56} />
        <h1 className="cap-login-wordmark" aria-label="RestoNiti">
          <span className="cap-brand-resto">Resto</span>
          <span className="cap-brand-niti">Niti</span>
        </h1>
        <p>Captain</p>
        {brandingName ? <p className="cap-login-hotel">{brandingName}</p> : null}
      </div>

      <form
        className="cap-login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin();
        }}
      >
        {error ? <div className="cap-error">{error}</div> : null}

        <div className="cap-login-status">
          <span>
            <span className={`cap-legend-dot ${live ? "is-sent" : connection === "reconnecting" ? "is-send" : ""}`} />
            {connectionLabel(connection)}
          </span>
          <span>{pairingNeeds || !pairingCode ? "Needs pairing" : "Paired"}</span>
        </div>

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
            <label htmlFor="cap-pair">Pairing code</label>
            <input
              id="cap-pair"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
              placeholder="From the POS QR"
            />
          </div>
        ) : (
          <div className="cap-paired-row">
            <span>Paired with this restaurant</span>
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

      <p className="cap-login-hint">Use the same Wi-Fi as the restaurant POS.</p>
      {origin ? (
        <p className="cap-login-hint">
          {origin}{" "}
          <button
            type="button"
            className="cap-text-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(origin).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : null}
    </div>
  );
}
