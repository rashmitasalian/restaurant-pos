import React from "react";
import { RefreshCw } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { StatusDot } from "../../ui/components/ui/StatusDot";
import { connectionLabel, type ConnectionState } from "../copy";

export function MeScreen({
  user,
  hotelName,
  connection,
  pairingCode,
  pairingNeeds,
  onRetry,
  onLogout,
}: {
  user: { displayName?: string; username: string; role?: string } | null;
  hotelName?: string;
  connection: ConnectionState;
  pairingCode?: string;
  pairingNeeds?: boolean;
  onRetry: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const name =
    String(user?.displayName || "")
      .replace(/^captain\s+/i, "")
      .trim() ||
    user?.username ||
    "Captain";
  const live = connection === "live";
  const [confirmOut, setConfirmOut] = React.useState(false);

  return (
    <div className="cap-stack cap-me">
      <h2 className="cap-page-title">Me</h2>
      <div className="cap-me-card">
        <div className="cap-more-avatar">{name.charAt(0).toUpperCase()}</div>
        <div>
          <strong>{name}</strong>
          <div className="cap-meta">Captain</div>
        </div>
      </div>

      <dl className="cap-me-meta">
        <div>
          <dt>Restaurant</dt>
          <dd>{hotelName || "RestoNiti"}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd className="cap-me-conn">
            <StatusDot
              tone={live ? "success" : connection === "reconnecting" ? "attention" : "danger"}
              label={connectionLabel(connection)}
              decorative
            />
            {connectionLabel(connection)}
          </dd>
        </div>
        <div>
          <dt>Pairing</dt>
          <dd>{pairingNeeds ? "Needs pairing" : pairingCode ? "Paired" : "Not saved"}</dd>
        </div>
      </dl>

      {!live ? (
        <button type="button" className="cap-btn cap-btn-quiet" onClick={onRetry}>
          <Icon icon={RefreshCw} size="md" />
          Try again
        </button>
      ) : null}

      {confirmOut ? (
        <div className="cap-me-confirm">
          <p>Sign out of Captain on this phone?</p>
          <button type="button" className="cap-btn cap-btn-danger" onClick={() => void onLogout()}>
            Sign out
          </button>
          <button type="button" className="cap-btn cap-btn-quiet" onClick={() => setConfirmOut(false)}>
            Stay signed in
          </button>
        </div>
      ) : (
        <button type="button" className="cap-btn cap-btn-danger" onClick={() => setConfirmOut(true)}>
          Sign out
        </button>
      )}
    </div>
  );
}
