import React from "react";
import { LayoutGrid, ReceiptText, UserRound } from "lucide-react";
import { Icon } from "../ui/components/ui/Icon";
import { StatusDot } from "../ui/components/ui/StatusDot";

export type CaptainTab = "floor" | "kots" | "me";

export function CaptainShell({
  title,
  occupancy,
  connected,
  error,
  showNav,
  hideHeader,
  lockBody,
  activeTab,
  unsentCount,
  onTabChange,
  children,
}: {
  title: string;
  occupancy?: string;
  connected: boolean;
  error: string | null;
  showNav: boolean;
  hideHeader?: boolean;
  lockBody?: boolean;
  activeTab: CaptainTab | null;
  unsentCount?: number;
  onTabChange: (tab: CaptainTab) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="cap-shell">
      {hideHeader ? null : (
        <header className="cap-top">
          <div className="cap-top-copy">
            <h1>{title}</h1>
            {occupancy ? <div className="cap-occupancy">{occupancy}</div> : null}
          </div>
          <span className="cap-conn" title={connected ? "Connected" : "Offline"}>
            <StatusDot
              tone={connected ? "success" : "attention"}
              label={connected ? "Connected" : "Offline"}
            />
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
        <nav className="cap-bottom-nav" aria-label="Captain">
          <button
            type="button"
            className={`cap-bottom-nav-item ${activeTab === "floor" ? "active" : ""}`}
            onClick={() => onTabChange("floor")}
          >
            <Icon icon={LayoutGrid} size="lg" />
            Floor
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
