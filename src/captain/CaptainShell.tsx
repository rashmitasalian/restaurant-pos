import React from "react";
import { LayoutGrid, ReceiptText, UserRound } from "lucide-react";
import { Icon } from "../ui/components/ui/Icon";
import { StatusDot } from "../ui/components/ui/StatusDot";
import restoNitiMark from "../ui/assets/restoniti-icon.png";
import { connectionLabel, type ConnectionState } from "./copy";

export type CaptainTab = "floor" | "kots" | "me";

export function CaptainShell({
  connection,
  error,
  showNav,
  hideHeader,
  lockBody,
  activeTab,
  unsentCount,
  onTabChange,
  children,
}: {
  connection: ConnectionState;
  error: string | null;
  showNav: boolean;
  hideHeader?: boolean;
  lockBody?: boolean;
  activeTab: CaptainTab | null;
  unsentCount?: number;
  onTabChange: (tab: CaptainTab) => void;
  children: React.ReactNode;
}) {
  const live = connection === "live";
  const reconnecting = connection === "reconnecting";
  return (
    <div className="cap-shell">
      {hideHeader ? null : (
        <header className="cap-top">
          <div className="cap-brand-lockup">
            <img src={restoNitiMark} alt="" className="cap-brand-mark" width={28} height={28} />
            <div className="cap-brand-name" aria-label="RestoNiti">
              <span className="cap-brand-resto">Resto</span>
              <span className="cap-brand-niti">Niti</span>
            </div>
          </div>
          <span
            className={`cap-live-chip ${live ? "is-live" : reconnecting ? "is-wait" : "is-offline"}`}
            title={connectionLabel(connection)}
          >
            <StatusDot
              tone={live ? "success" : reconnecting ? "attention" : "danger"}
              label={connectionLabel(connection)}
              decorative
            />
            <span>{connectionLabel(connection)}</span>
          </span>
        </header>
      )}

      <main
        className={`cap-body${hideHeader ? " cap-body-flush" : ""}${lockBody ? " cap-body-lock" : ""}`}
      >
        {error ? <div className="cap-error">{error}</div> : null}
        {children}
      </main>

      {showNav ? (
        <nav className="cap-bottom-nav" aria-label="RestoNiti">
          <button
            type="button"
            className={`cap-bottom-nav-item ${activeTab === "floor" ? "active" : ""}`}
            onClick={() => onTabChange("floor")}
          >
            <Icon icon={LayoutGrid} size="lg" />
            Tables
          </button>
          <button
            type="button"
            className={`cap-bottom-nav-item ${activeTab === "kots" ? "active" : ""}`}
            onClick={() => onTabChange("kots")}
          >
            <span className="cap-nav-icon-wrap">
              <Icon icon={ReceiptText} size="lg" />
              {unsentCount && unsentCount > 0 ? (
                <span className="cap-nav-badge">{unsentCount > 9 ? "9+" : unsentCount}</span>
              ) : null}
            </span>
            KOTs
          </button>
          <button
            type="button"
            className={`cap-bottom-nav-item ${activeTab === "me" ? "active" : ""}`}
            onClick={() => onTabChange("me")}
          >
            <Icon icon={UserRound} size="lg" />
            Me
          </button>
        </nav>
      ) : null}
    </div>
  );
}
