import React from "react";
import { ENV } from "../config/env";
import { ROLES } from "../config/roles";
import type { Role } from "../config/roles";
import Tables from "./screens/Tables/Tables";
import Billing from "./screens/Billing/Billing";
import KOTQueue from "./screens/KOTQueue/KOTQueue";
import Reports from "./screens/Reports/Reports";
import Customers from "./screens/Customers/Customers";
import Manager, {
  MANAGER_SECTION_HASH,
  managerSectionFromHash,
  type ManagerSection,
} from "./screens/Manager/Manager";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, AuthContext } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { useFocusTrap } from "./hooks/useFocusTrap";
import LoginScreen from "./screens/Login/LoginScreen";
import ChangePasswordScreen from "./screens/Login/ChangePasswordScreen";
import SetupScreen from "./screens/Login/SetupScreen";
import {
  ensureIndexes,
  getConfigBranding,
  hasUsers as hasExistingUsers,
  pruneAuditLogs,
  pruneOrderHistory,
} from "../app/db/posRepository";
import restoNitiMark from "./assets/restoniti-icon.png";

type Page = "tables" | "billing" | "kot" | "reports" | "customers" | "manager";

export default function App() {
  // Track whether the DB has any users (null = still loading)
  const [hasUsers, setHasUsers] = React.useState<boolean | null>(null);

  // Run DB migrations and check for existing users on first render.
  React.useEffect(() => {
    (async () => {
      try {
        await ensureIndexes();
      } catch (e) {
        console.error("[indexes] failed:", e);
      }
      // Public setup-state check. User listing is admin-only and cannot be used pre-login.
      try {
        setHasUsers(await hasExistingUsers());
      } catch (e) {
        setHasUsers(false);
      }
    })();
  }, []);

  const MainContent: React.FC = () => {
    const auth = React.useContext(AuthContext);
    const maintenanceRanRef = React.useRef(false);
    const [branding, setBranding] = React.useState({
      hotelName: ENV.HOTEL_NAME || "",
      tagline: "POINT OF SALE",
      logoDataUrl: null as string | null,
    });

    React.useEffect(() => {
      const loadBranding = async () => {
        try {
          const cfg = await getConfigBranding();
          const name = (cfg.hotelName || ENV.HOTEL_NAME || "").trim();
          setBranding({
            hotelName: name,
            tagline: cfg.tagline || "POINT OF SALE",
            logoDataUrl: typeof cfg.logoDataUrl === "string" ? cfg.logoDataUrl : null,
          });
        } catch {
          // Keep the current header branding if persisted settings cannot be loaded.
        }
      };
      loadBranding();
      window.addEventListener("branding-changed", loadBranding);
      return () => window.removeEventListener("branding-changed", loadBranding);
      // Re-run when session token changes (login/logout) so that branding is
      // reloaded after the user authenticates on startup — the initial mount
      // call above may fail when the main-process session map is empty
      // (cleared on restart) before the user has logged in.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth?.session?.sessionToken]);

    React.useEffect(() => {
      if (
        maintenanceRanRef.current ||
        auth?.loading ||
        !auth?.session ||
        auth.session.role !== "admin" ||
        auth.session.requirePasswordChange
      ) {
        return;
      }
      maintenanceRanRef.current = true;
      (async () => {
        try {
          await pruneAuditLogs();
        } catch (e) {
          console.warn("[audit-prune] skipped:", e);
        }
        try {
          await pruneOrderHistory();
        } catch (e) {
          console.warn("[history-prune] skipped:", e);
        }
      })();
    }, [auth?.loading, auth?.session]);

    // Role-based navigation
    const navItems = [
      { k: "tables", t: "Tables", icon: "▦" },
      { k: "billing", t: "Billing", icon: "⊟" },
      { k: "kot", t: "KOT Queue", icon: "⊕" },
      { k: "reports", t: "Reports", icon: "≡" },
      { k: "customers", t: "Customers", icon: "⊛" },
      { k: "manager", t: "Manager", icon: "MG" },
    ];

    // Role-based allow-list - driven by the centralised role config.
    // Enforced in the nav (hidden items), hashchange handler, and
    // the per-page render guard below.
    const allowedPages: string[] = ROLES[auth?.session?.role as Role]?.pages ?? [
      "tables",
      "billing",
      "kot",
    ];

    const getInitial = (): Page => {
      const hash = (typeof window !== "undefined" && window.location.hash) || "";
      const hashPageMap: Record<string, Page> = {
        "#billing": "billing",
        "#customers": "customers",
        "#tables": "tables",
        "#kot": "kot",
        "#reports": "reports",
        "#manager": "manager",
      };
      if (managerSectionFromHash(hash)) {
        return "manager";
      }
      if (hashPageMap[hash]) {
        return hashPageMap[hash];
      }
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("lastPage") : null;
      const validPages = Object.values(hashPageMap) as Page[];
      if (saved && validPages.includes(saved as Page)) {
        return saved as Page;
      }
      return "tables";
    };

    const [page, setPage] = React.useState<Page>(getInitial);
    const [managerSection, setManagerSection] = React.useState<ManagerSection>(() => {
      const hash = (typeof window !== "undefined" && window.location.hash) || "";
      return managerSectionFromHash(hash) || "grocery";
    });
    const [now, setNow] = React.useState(new Date());
    // show Billing inline next to Tables (single-page split view)
    const [showBillingInline, setShowBillingInline] = React.useState<boolean>(false);
    // when true, render tables and billing side-by-side at equal width
    const inlineLayout = page === "tables" && showBillingInline;

    React.useEffect(() => {
      const id = setInterval(() => setNow(new Date()), 30000);
      return () => clearInterval(id);
    }, []);

    React.useEffect(() => {
      const onHash = () => {
        const hashPageMap: Record<string, Page> = {
          "#billing": "billing",
          "#customers": "customers",
          "#tables": "tables",
          "#kot": "kot",
          "#reports": "reports",
          "#manager": "manager",
        };
        const sectionTarget = managerSectionFromHash(window.location.hash);
        const target = sectionTarget ? "manager" : hashPageMap[window.location.hash];
        if (!target) {
          return;
        }
        if (allowedPages.includes(target)) {
          if (sectionTarget) {
            setManagerSection(sectionTarget);
          }
          setPage(target);
        } else {
          // Silently redirect unauthorised hash navigation back to tables.
          window.location.hash = "#tables";
          setPage("tables");
        }
      };

      const onSelectTable = (e: Event) => {
        const detail = (e as CustomEvent)?.detail;
        if (detail?.table && !detail?._forwarded) {
          const tn = detail.table;
          // Always show Billing full-screen when a table is selected
          setPage("billing");
          setShowBillingInline(false);
          setTimeout(() => {
            try {
              // Forward the event so Billing's listener picks it up.
              // Mark as _forwarded to prevent infinite re-dispatch.
              if (typeof window !== "undefined" && window.location.hash === "#billing") {
                window.dispatchEvent(
                  new CustomEvent("select-table", { detail: { table: tn, _forwarded: true } }),
                );
              }
            } catch (err) {}
          }, 60);
        }
      };

      window.addEventListener("hashchange", onHash);
      window.addEventListener("select-table", onSelectTable as EventListener);
      return () => {
        window.removeEventListener("select-table", onSelectTable as EventListener);
        window.removeEventListener("hashchange", onHash);
      };
    }, [allowedPages]);

    React.useEffect(() => {
      try {
        window.localStorage.setItem("lastPage", page);
        const hash = {
          billing: "#billing",
          tables: "#tables",
          kot: "#kot",
          reports: "#reports",
          customers: "#customers",
          manager: MANAGER_SECTION_HASH[managerSection],
        }[page];
        const currentHash = window.location.hash;
        const currentManagerSection = managerSectionFromHash(currentHash);
        if (!(page === "manager" && currentManagerSection === managerSection)) {
          window.location.hash = hash || "#tables";
        }
        // if navigating away from tables, hide inline billing
        if (page !== "tables") {
          setShowBillingInline(false);
        }
      } catch (e) {
        // ignore storage errors
      }
    }, [page, managerSection]);

    // User menu (dropdown) state + outside click handler
    const userMenuRef = React.useRef<HTMLDivElement | null>(null);
    const [userMenuOpen, setUserMenuOpen] = React.useState(false);
    const [profileOpen, setProfileOpen] = React.useState(false);
    const closeProfile = React.useCallback(() => setProfileOpen(false), []);
    const profileDialogRef = useFocusTrap<HTMLDivElement>(profileOpen, closeProfile);
    React.useEffect(() => {
      const onDocClick = (e: MouseEvent) => {
        if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
          setUserMenuOpen(false);
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setUserMenuOpen(false);
        }
      };
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }, []);

    // Auth guards must come after all hooks to keep order stable.
    // Show a neutral loading screen while the first DB-backed session verification
    // is in progress. This prevents any brief window where a tampered localStorage
    // role could be rendered.
    if (auth?.loading) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      );
    }
    if (!auth?.session) {
      // First-run: no users exist, so show setup wizard instead of login.
      if (hasUsers === false) {
        return <SetupScreen onComplete={() => setHasUsers(true)} />;
      }
      return <LoginScreen />;
    }
    // If the account requires a password change (e.g. freshly seeded admin),
    // gate access to the entire application until a new password is set.
    if (auth.session.requirePasswordChange) {
      return <ChangePasswordScreen />;
    }

    return (
      <div
        id="app-root"
        // pin app-root to viewport so body can't scroll; main will be the single scroller
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        <header id="app-header" style={{ userSelect: "none", flexShrink: 0 }}>
          <style>{`
            .skip-link {
              position: fixed;
              top: 8px;
              left: 8px;
              z-index: 5000;
              transform: translateY(-140%);
              background: #111827;
              color: #fff;
              padding: 8px 12px;
              border-radius: 8px;
              font-size: 13px;
              font-weight: 800;
              text-decoration: none;
              transition: transform 120ms ease;
            }
            .skip-link:focus {
              transform: translateY(0);
            }
            .hdr-nav-btn {
              display: flex; align-items: center;
              padding: 0 16px; height: 100%;
              background: transparent; border: none;
              border-bottom: 2.5px solid transparent;
              border-top: 2.5px solid transparent;
              color: #78716c; font-weight: 500; font-size: 13px;
              cursor: pointer; white-space: nowrap; outline: none;
              transition: color 140ms, border-color 140ms, background 140ms;
            }
            .hdr-nav-btn:hover {
              color: #292524;
              background: #fff7ed;
              border-bottom-color: #fcd34d;
            }
            .hdr-nav-btn.hdr-active {
              color: #92400e;
              font-weight: 700;
              border-bottom-color: #f59e0b;
              background: #fffbeb;
            }
            .hdr-nav-btn:focus-visible,
            .hdr-user-btn:focus-visible,
            .hdr-dd-item:focus-visible {
              outline: 2px solid #f59e0b;
              outline-offset: 2px;
              box-shadow: 0 0 0 3px rgba(245,158,11,0.2);
            }
            .hdr-user-btn {
              display: flex; align-items: center; gap: 8px;
              background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
              padding: 5px 10px 5px 6px; cursor: pointer;
              transition: background 120ms, border-color 120ms;
            }
            .hdr-user-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
            .hdr-dropdown {
              position: absolute; right: 0; top: calc(100% + 6px);
              min-width: 182px; background: #fff;
              border: 1px solid #e2e8f0;
              box-shadow: 0 8px 30px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06);
              border-radius: 12px; overflow: hidden; z-index: 2000;
              animation: hdrFadeIn 100ms ease;
            }
            .hdr-dd-item {
              display: block; width: 100%; padding: 10px 16px;
              text-align: left; border: none; background: transparent;
              font-size: 13px; font-weight: 500; color: #374151; cursor: pointer;
              transition: background 80ms;
            }
            .hdr-dd-item:hover { background: #f8fafc; }
            .hdr-dd-danger { color: #dc2626; font-weight: 700; }
            .hdr-dd-danger:hover { background: #fef2f2; }
            .hdr-dd-sep { height: 1px; background: #f1f5f9; margin: 2px 0; }
            @keyframes hdrFadeIn {
              from { opacity: 0; transform: translateY(-4px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {/* Top bar */}
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              height: 54,
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              gap: 14,
            }}
          >
            {/* Product + restaurant brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img
                  src={restoNitiMark}
                  alt=""
                  style={{ width: 34, height: 34, borderRadius: 9, display: "block" }}
                />
                <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: -0.3, lineHeight: 1 }}>
                  <span style={{ color: "#111827" }}>Resto</span>
                  <span style={{ color: "#f59e0b" }}>Niti</span>
                </div>
              </div>

              {(branding.logoDataUrl || branding.hotelName) && (
                <>
                  <div style={{ width: 1, height: 28, background: "#e2e8f0" }} />

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {branding.logoDataUrl && (
                      <img
                        src={branding.logoDataUrl}
                        alt=""
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          objectFit: "contain",
                          border: "1px solid #e2e8f0",
                          background: "#fff",
                          padding: 3,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {branding.hotelName && (
                      <div style={{ lineHeight: 1 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 15,
                            color: "#0f172a",
                            letterSpacing: -0.3,
                          }}
                        >
                          {branding.hotelName}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#f59e0b",
                            marginTop: 2,
                            letterSpacing: "0.1em",
                          }}
                        >
                          {branding.tagline}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Vertical rule */}
            <div style={{ width: 1, height: 28, background: "#e2e8f0", flexShrink: 0 }} />

            <div style={{ flex: 1 }} />

            {/* Clock pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "5px 13px",
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#22c55e",
                  boxShadow: "0 0 0 2.5px rgba(34,197,94,0.2)",
                  flexShrink: 0,
                }}
              />
              <div style={{ lineHeight: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#0f172a",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: 0.4,
                  }}
                >
                  {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div
                  style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, letterSpacing: "0.02em" }}
                >
                  {now.toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </div>
              </div>
            </div>

            {/* User menu */}
            <div ref={userMenuRef as any} style={{ position: "relative" }}>
              <button
                className="hdr-user-btn"
                onClick={() => setUserMenuOpen((s) => !s)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background:
                      auth.session.role === "admin"
                        ? "linear-gradient(135deg, #7c3aed, #8b5cf6)"
                        : "linear-gradient(135deg, #d97706, #f59e0b)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  {(auth.session.displayName || auth.session.username).charAt(0).toUpperCase()}
                </div>
                <div style={{ lineHeight: 1, textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {auth.session.displayName || auth.session.username}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#94a3b8",
                      marginTop: 2,
                      textTransform: "capitalize",
                    }}
                  >
                    {auth.session.role}
                  </div>
                </div>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                  style={{ flexShrink: 0, marginLeft: 2, color: "#94a3b8" }}
                >
                  <path
                    d="M1.5 3.5L5 7L8.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {userMenuOpen && (
                <div className="hdr-dropdown" role="menu">
                  <button
                    className="hdr-dd-item"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    My Profile
                  </button>
                  <div className="hdr-dd-sep" />
                  <button
                    className="hdr-dd-item hdr-dd-danger"
                    role="menuitem"
                    onClick={() => auth.logout()}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Nav bar */}
          <nav
            id="main-nav"
            aria-label="Main navigation"
            style={{
              display: "flex",
              alignItems: "stretch",
              paddingLeft: 8,
              height: 42,
              background: "#ffffff",
              borderBottom: "2px solid #fde68a",
              boxShadow: "0 2px 8px rgba(245,158,11,0.07)",
            }}
          >
            {navItems
              .filter((n) => allowedPages.includes(n.k))
              .map((it) => {
                const active = page === it.k;
                return (
                  <button
                    key={it.k}
                    type="button"
                    className={`hdr-nav-btn${active ? " hdr-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setPage(it.k as any);
                      window.location.hash = `#${it.k}`;
                    }}
                  >
                    {it.t}
                  </button>
                );
              })}
          </nav>
        </header>

        <div id="main-content" tabIndex={-1} style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {inlineLayout ? (
            // Equal 50/50 split when inline billing is active
            <div id="split-view" style={{ display: "flex", flex: 1, gap: 0, minHeight: 0 }}>
              <main
                id="tables-section"
                // split view columns can scroll independently
                style={{
                  flex: 1,
                  padding: 0,
                  overflow: "auto",
                  minHeight: 0,
                }}
              >
                <Tables />
              </main>
              <aside
                id="billing-section"
                style={{
                  flex: 1,
                  borderLeft: "1px solid #eee",
                  background: "var(--pos-bg, #ffffff)",
                  overflow: "auto",
                  minHeight: 0,
                }}
              >
                <Billing />
              </aside>
            </div>
          ) : (
            // Default layout: main content
            <>
              <main
                style={{
                  flex: 1,
                  padding: 0,
                  overflow: "auto",
                  minHeight: 0,
                  background: "var(--pos-bg, #ffffff)",
                }}
              >
                {/* Render guard: each page checks the allow-list so that
                    even if hash navigation somehow sets an unauthorised page,
                    the component never mounts. This is defense-in-depth on top
                    of the hashchange handler's redirect. */}
                {page === "tables" && allowedPages.includes("tables") && <Tables />}
                {page === "billing" && allowedPages.includes("billing") && <Billing />}
                {page === "kot" && allowedPages.includes("kot") && <KOTQueue />}
                {page === "customers" && allowedPages.includes("customers") && <Customers />}
                {page === "reports" && allowedPages.includes("reports") && <Reports />}
                {page === "manager" && allowedPages.includes("manager") && (
                  <Manager
                    section={managerSection}
                    onSectionChange={(section) => {
                      setManagerSection(section);
                      setPage("manager");
                    }}
                  />
                )}
              </main>
            </>
          )}
        </div>

        {/* Profile modal */}
        {profileOpen && (
          <div
            onClick={closeProfile}
            style={{
              position: "fixed",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.4)",
              zIndex: 3000,
            }}
          >
            <div
              ref={profileDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="profileDialogTitle"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 360,
                background: "#fff",
                borderRadius: 12,
                padding: 28,
                boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <h3 id="profileDialogTitle" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                  My Profile
                </h3>
                <button
                  onClick={closeProfile}
                  aria-label="Close"
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 20,
                    cursor: "pointer",
                    color: "#9ca3af",
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background:
                      auth?.session?.role === "admin"
                        ? "linear-gradient(135deg, #7c3aed, #8b5cf6)"
                        : "linear-gradient(135deg, #d97706, #f59e0b)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    fontWeight: 900,
                    color: "#fff",
                  }}
                >
                  {(auth?.session?.username?.[0] ?? "?").toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>
                    {auth?.session?.username ?? "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      textTransform: "capitalize",
                      marginTop: 2,
                    }}
                  >
                    {auth?.session?.role ?? "—"}
                  </div>
                </div>
              </div>
              {auth?.session?.sessionStart && (
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>
                  Session started: {new Date(auth.session.sessionStart).toLocaleString("en-IN")}
                </div>
              )}
              <button
                onClick={() => {
                  closeProfile();
                  auth?.logout();
                }}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 8,
                  border: "1.5px solid #e5e7eb",
                  background: "#fff",
                  color: "#dc2626",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <MainContent />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
