import React from "react";
import { RefreshCw } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { StatusDot } from "../../ui/components/ui/StatusDot";

export function MeScreen({
  user,
  hotelName,
  connected,
  deviceId,
  pairingCode,
  onRetry,
  onLogout,
}: {
  user: { displayName?: string; username: string; role?: string } | null;
  hotelName?: string;
  connected: boolean;
  deviceId: string;
  pairingCode?: string;
  onRetry: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const name = user?.displayName || user?.username || "Captain";
  const shortDevice = deviceId.length > 18 ? `${deviceId.slice(0, 16)}…` : deviceId;

  return (
    <div className="cap-stack cap-me">
      <div className="cap-me-card">
        <div className="cap-more-avatar">{name.charAt(0).toUpperCase()}</div>
        <div>
          <strong>{name}</strong>
          <div className="cap-meta">Captain</div>
        </div>
      </div>

      <div className="cap-me-card cap-me-status">
        <div className="cap-me-status-row">
          <StatusDot tone={connected ? "success" : "attention"} label={connected ? "Connected" : "Offline"} />
          <span>{connected ? "Connected to POS" : "Offline"}</span>
        </div>
        {!connected ? (
          <button type="button" className="cap-btn cap-btn-quiet" onClick={onRetry}>
            <Icon icon={RefreshCw} size="md" />
            Retry
          </button>
        ) : null}
      </div>

      <dl className="cap-me-meta">
        <div>
          <dt>Hotel</dt>
          <dd>{hotelName || "RestoNiti"}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>{shortDevice}</dd>
        </div>
        <div>
          <dt>Pairing</dt>
          <dd>{pairingCode ? "Paired with this POS" : "Not saved"}</dd>
        </div>
      </dl>

      <button type="button" className="cap-btn cap-btn-danger" onClick={() => void onLogout()}>
        Sign out
      </button>
    </div>
  );
}
