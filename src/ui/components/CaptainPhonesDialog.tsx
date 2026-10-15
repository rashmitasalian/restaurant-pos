import React from "react";
import QRCode from "qrcode";
import { Check } from "lucide-react";
import { Modal } from "./ui/Modal";
import { useRolePermissions } from "../../app/auth/useRolePermissions";

export type GatewayPhone = {
  username: string;
  displayName: string;
  deviceLabel: string;
};

export type GatewayStatus = {
  running?: boolean;
  pairingCode?: string;
  urls?: string[];
  clients?: number;
  phones?: GatewayPhone[];
  error?: string | null;
};

export function CaptainPhonesDialog({
  open,
  status,
  onClose,
  onRotated,
}: {
  open: boolean;
  status: GatewayStatus | null;
  onClose: () => void;
  onRotated: (status: GatewayStatus) => void;
}) {
  const perms = useRolePermissions();
  const [qrUrl, setQrUrl] = React.useState("");
  const [copied, setCopied] = React.useState("");
  const [copyNote, setCopyNote] = React.useState("");
  const copyTimer = React.useRef<number | null>(null);
  const [confirmRotate, setConfirmRotate] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [rotateError, setRotateError] = React.useState("");

  const code = String(status?.pairingCode || "").toUpperCase();
  const base = status?.urls?.[0] || "";
  const pairUrl = base && code ? `${base}/?pair=${encodeURIComponent(code)}` : base;

  React.useEffect(() => {
    if (!open) {
      setConfirmRotate(false);
      setRotateError("");
      setCopied("");
      setCopyNote("");
      if (copyTimer.current) {
        window.clearTimeout(copyTimer.current);
        copyTimer.current = null;
      }
      return;
    }
    if (!pairUrl) {
      setQrUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(pairUrl, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) {
          setQrUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrUrl("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, pairUrl]);

  const copy = async (label: string, value: string) => {
    if (!value) {
      return;
    }
    if (copyTimer.current) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    try {
      if (window.pos?.copyText) {
        const result = await window.pos.copyText(value);
        if (!result?.ok) {
          throw new Error("copy-failed");
        }
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(label);
      setCopyNote(label === "code" ? "Pairing code copied." : "Address copied.");
      copyTimer.current = window.setTimeout(() => {
        setCopied("");
        setCopyNote("");
        copyTimer.current = null;
      }, 3000);
    } catch {
      setCopied("");
      setCopyNote("Could not copy. Try again.");
    }
  };

  const rotate = async () => {
    setRotating(true);
    setRotateError("");
    try {
      const next = await window.pos?.gateway?.rotatePairing?.();
      if (next) {
        onRotated(next);
      }
      setConfirmRotate(false);
    } catch {
      setRotateError("Couldn’t rotate the pairing code.");
    } finally {
      setRotating(false);
    }
  };

  const phones = status?.phones || [];

  return (
    <Modal open={open} title="Captain phones" onClose={onClose} large>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
        <div>
          {qrUrl ? (
            <img src={qrUrl} alt="QR code that opens Captain and fills the pairing code" width={220} height={220} />
          ) : (
            <div style={{ width: 220, height: 220 }} />
          )}
          <p className="pos-meta" style={{ marginTop: 8 }}>
            Scan on the restaurant Wi-Fi. The phone opens Captain with the code filled in.
          </p>
        </div>
        <div>
          <div className="pos-meta">Pairing code</div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "0.12em", margin: "4px 0 12px" }}>
            {code || "—"}
          </div>
          <div className="pos-meta">Address</div>
          <div style={{ fontWeight: 600, margin: "4px 0 12px", wordBreak: "break-all" }}>{pairUrl || "Gateway is off"}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="pos-btn" disabled={!pairUrl} onClick={() => void copy("url", pairUrl)}>
              {copied === "url" ? <Check size={16} strokeWidth={2.5} /> : null}
              {copied === "url" ? "Copied" : "Copy URL"}
            </button>
            <button type="button" className="pos-btn" disabled={!code} onClick={() => void copy("code", code)}>
              {copied === "code" ? <Check size={16} strokeWidth={2.5} /> : null}
              {copied === "code" ? "Copied" : "Copy code"}
            </button>
          </div>
          {copyNote ? (
            <p
              className="pos-meta"
              role="status"
              aria-live="polite"
              style={{
                margin: "8px 0 0",
                color: copyNote.startsWith("Could not")
                  ? "var(--pos-danger)"
                  : "var(--pos-success-text)",
              }}
            >
              {copyNote}
            </p>
          ) : null}
          {perms.has("system:settings") ? (
            <div style={{ marginTop: 16 }}>
              {confirmRotate ? (
                <div>
                  <p>
                    New phones will need the new code. Captains already signed in stay signed in until the POS restarts.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="pos-btn" disabled={rotating} onClick={() => void rotate()}>
                      {rotating ? "Rotating…" : "Rotate code"}
                    </button>
                    <button type="button" className="pos-btn" onClick={() => setConfirmRotate(false)}>
                      Cancel
                    </button>
                  </div>
                  {rotateError ? <p>{rotateError}</p> : null}
                </div>
              ) : (
                <button type="button" className="pos-btn" onClick={() => setConfirmRotate(true)}>
                  Rotate pairing code
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <div className="pos-meta" style={{ marginBottom: 8 }}>
          Signed in ({phones.length})
        </div>
        {phones.length === 0 ? (
          <p className="pos-meta">No captains are signed in.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {phones.map((phone) => (
              <li key={`${phone.username}-${phone.deviceLabel}`}>
                {phone.displayName}
                {phone.deviceLabel ? ` · ${phone.deviceLabel}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
