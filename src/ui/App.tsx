import React from "react";
import { ENV } from "../config/env";
import { ROLES } from "../config/roles";
import type { Role } from "../config/roles";
import { useRolePermissions } from "../app/auth/useRolePermissions";
import {
  getDefaultManageSection,
  getDefaultPeopleTab,
  canAccessManageSection,
  canAccessPeopleTab,
} from "../shared/permissions";
import {
  MANAGER_SECTION_HASH,
  PEOPLE_TAB_HASH,
  managerSectionFromHash,
  peopleTabFromHash,
  type ManagerSection,
} from "./screens/Manager/managerSections";
import ErrorBoundary from "./components/ErrorBoundary";
import { Icon } from "./components/ui/Icon";
import { LayoutGrid, Receipt, ChefHat, BarChart3, Users, Settings2 } from "lucide-react";
import { AuthProvider, AuthContext } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { useBackdropDismiss } from "./hooks/useBackdropDismiss";
import { useFocusTrap } from "./hooks/useFocusTrap";
import {
  ensureIndexes,
  getConfigBranding,
  getEnabledServiceModes,
  hasUsers as hasExistingUsers,
  pruneAuditLogs,
  pruneOrderHistory,
} from "../app/db/posRepository";
import { getDefaultServiceModes } from "../shared/serviceModes";
import restoNitiMark from "./assets/restoniti-icon.png";
import { PageLoadingFallback } from "./components/PageLoadingFallback";
import Activation from "./screens/Activation/Activation";
import { CaptainPhonesDialog, type GatewayStatus } from "./components/CaptainPhonesDialog";
import {
  prefetchScreen,
  schedulePostLoginPrefetch,
  screenImports,
  type ScreenPrefetchKey,
} from "./screenPrefetch";

const Tables = React.lazy(screenImports.tables);
const Billing = React.lazy(screenImports.billing);
const KOTQueue = React.lazy(screenImports.kot);
const Customers = React.lazy(screenImports.customers);
const Manager = React.lazy(screenImports.manager);
const LoginScreen = React.lazy(screenImports.login);
const ChangePasswordScreen = React.lazy(screenImports.changePassword);
const SetupScreen = React.lazy(screenImports.setup);

type Page = "tables" | "billing" | "kot" | "reports" | "customers" | "manager";

function screenFallbackForPage(page: Page | null): React.ReactNode {
  if (page === "manager") {
    return <PageLoadingFallback variant="manage" label="Opening Manage" />;
  }
  return <PageLoadingFallback variant="page" />;
}

function prefetchForPage(page: Page) {
  const map: Partial<Record<Page, ScreenPrefetchKey>> = {
    tables: "tables",
    billing: "billing",
    kot: "kot",
    customers: "customers",
    manager: "manager",
  };
  const key = map[page];
  if (key) {
    prefetchScreen(key);
  }
}

function getRendererStartupElapsedMs() {
  const t0 = Number((window as any).__posStartupT0 || 0);
  if (!Number.isFinite(t0) || t0 <= 0 || typeof performance === "undefined") {
    return null;
  }
  return Number((performance.now() - t0).toFixed(1));
}

function GatewayChip() {
  const [status, setStatus] = React.useState<GatewayStatus | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await window.pos?.gateway?.status?.();
        if (!cancelled) {
          setStatus(next || null);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      }
    };
    load();
    const timer = setInterval(load, 15000);
    const unsub = window.pos?.events?.onDomainEvent?.((event) => {
      if (event?.type === "gateway-status") {
        load();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub?.();
    };
  }, []);

  if (!status?.running) {
    return null;
  }
  const url = status.urls?.[0] || "";
  return (
    <>
      <button
        type="button"
        className="pos-clock"
        title={url ? `Captain phones: ${url}` : "Local Gateway online"}
        style={{ maxWidth: 220, border: 0, cursor: "pointer", textAlign: "left" }}
        onClick={() => setOpen(true)}
      >
        <div className="pos-clock-dot" aria-hidden="true" />
        <div>
          <div className="pos-clock-time" style={{ fontSize: 12 }}>
            Gateway · {status.clients || 0}
          </div>
          <div className="pos-clock-date" style={{ fontSize: 11 }}>
            Pair {String(status.pairingCode || "").toUpperCase()}
          </div>
        </div>
      </button>
      <CaptainPhonesDialog
        open={open}
        status={status}
        onClose={() => setOpen(false)}
        onRotated={(next) => setStatus(next)}
      />
    </>
  );
}

function MainContent({
  hasUsers,
  onSetupComplete,
}: {
  hasUsers: boolean | null;
  onSetupComplete: () => void;
}) {
  const auth = React.useContext(AuthContext);
  const perms = useRolePermissions();
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
  }, [auth?.session?.sessionToken]);

  React.useEffect(() => {
    if (
      maintenanceRanRef.current ||
      auth?.loading ||
      !auth?.session ||
      !perms.has("system:settings") ||
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
    { k: "tables", t: "Tables", icon: LayoutGrid },
    { k: "billing", t: "Billing", icon: Receipt },
    { k: "kot", t: "KOT Queue", icon: ChefHat },
    { k: "reports", t: "Reports", icon: BarChart3 },
    { k: "customers", t: "Customers", icon: Users },
    { k: "manager", t: "Manage", icon: Settings2 },
  ];

  const [enabledServiceModes, setEnabledServiceModes] = React.useState(() =>
    getDefaultServiceModes().filter((mode) => mode.enabled),
  );
  const [serviceModesLoaded, setServiceModesLoaded] = React.useState(false);
  const hasTableMode = enabledServiceModes.some((mode) => mode.requiresTable);

  // Role-based allow-list - driven by the centralised role config.
  // Enforced in the nav (hidden items), hashchange handler, and
  // the per-page render guard below.
  const allowedPages: string[] = ROLES[auth?.session?.role as Role]?.pages ?? [
    "tables",
    "billing",
    "kot",
  ];
  const effectiveAllowedPages = serviceModesLoaded
    ? hasTableMode
      ? allowedPages
      : allowedPages.filter((p) => p !== "tables")
    : allowedPages.filter((p) => p !== "tables");

  const fallbackPage: Page = effectiveAllowedPages.includes("billing") ? "billing" : "kot";
  const reportsOnly = perms.reportsOnly;

  const resolveManagerSection = (
    section: ManagerSection,
    hash: string,
    role: Role,
  ): ManagerSection => {
    if (reportsOnly) {
      return "reports";
    }
    if (section === "people") {
      const tab = peopleTabFromHash(hash);
      if (!canAccessPeopleTab(role, tab)) {
        const fallbackTab = getDefaultPeopleTab(role);
        window.location.hash = PEOPLE_TAB_HASH[fallbackTab];
        return "people";
      }
      return section;
    }
    if (canAccessManageSection(role, section)) {
      return section;
    }
    return getDefaultManageSection(role);
  };

  const canOpenManager = (section: ManagerSection | null, hash?: string) =>
    perms.canOpenManageSection(section, hash);

  const getInitial = (): Page => {
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    const hashPageMap: Record<string, Page> = {
      "#billing": "billing",
      "#customers": "customers",
      "#tables": "tables",
      "#kot": "kot",
      "#manager": "manager",
    };
    const section = managerSectionFromHash(hash);
    if (section) {
      if (canOpenManager(section, hash) && auth?.session?.role) {
        return "manager";
      }
      return fallbackPage;
    }
    if (hash === "#reports" && canOpenManager("reports")) {
      return "manager";
    }
    if (hashPageMap[hash]) {
      return hashPageMap[hash];
    }
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("lastPage") : null;
    const validPages = [...Object.values(hashPageMap), "manager"] as Page[];
    if (saved === "reports" && canOpenManager("reports")) {
      return "manager";
    }
    if (saved && validPages.includes(saved as Page)) {
      if (!hasTableMode && saved === "tables") {
        return fallbackPage;
      }
      return saved as Page;
    }
    return hasTableMode ? "tables" : fallbackPage;
  };

  const [page, setPage] = React.useState<Page>(getInitial);
  const [managerSection, setManagerSection] = React.useState<ManagerSection>(() => {
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    const role = auth?.session?.role as Role | undefined;
    const section =
      managerSectionFromHash(hash) || (role ? getDefaultManageSection(role) : "overview");
    if (!role) {
      return section;
    }
    return resolveManagerSection(section, hash, role);
  });

  // After login / role switch, drop any Manage section the new role cannot open
  // (e.g. admin left Settings open, then manager logs in on the same window).
  React.useEffect(() => {
    const role = auth?.session?.role as Role | undefined;
    if (!role) {
      return;
    }
    setManagerSection((current) => {
      if (canAccessManageSection(role, current)) {
        if (current === "people") {
          const tab = peopleTabFromHash(typeof window !== "undefined" ? window.location.hash : "");
          if (!canAccessPeopleTab(role, tab)) {
            const fallbackTab = getDefaultPeopleTab(role);
            if (typeof window !== "undefined") {
              window.location.hash = PEOPLE_TAB_HASH[fallbackTab];
            }
          }
        }
        return current;
      }
      const next = getDefaultManageSection(role);
      if (typeof window !== "undefined") {
        window.location.hash = MANAGER_SECTION_HASH[next];
      }
      return next;
    });
  }, [auth?.session?.role]);

  const firstScreenLoggedRef = React.useRef(false);
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
    const unsubscribe = window.pos?.events?.onDomainEvent?.((event) => {
      const type = String(event?.type || "");
      // publishOrdersChanged emits a single orders-changed; keep legacy tables/activity aliases.
      if (type === "orders-changed" || type === "tables-changed") {
        window.dispatchEvent(new Event("orders-changed"));
      }
      if (type === "activity-changed" || type === "orders-changed") {
        window.dispatchEvent(new Event("activity-changed"));
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  React.useEffect(() => {
    if (firstScreenLoggedRef.current || auth?.loading) {
      return;
    }
    let screen = "unknown";
    if (!auth?.session) {
      screen = hasUsers === false ? "setup" : "login";
    } else if (auth.session.requirePasswordChange) {
      screen = "change-password";
    } else {
      screen = page;
    }
    firstScreenLoggedRef.current = true;
    const elapsedMs = getRendererStartupElapsedMs();
    const context = {
      screen,
      elapsedMs,
    };
    console.info("[renderer-startup] first-screen-ready", context);
    window.pos?.writeLog?.("info", "[renderer-startup] first-screen-ready", context).catch(() => {
      // best effort telemetry
    });
  }, [auth?.loading, auth?.session, hasUsers, page]);

  React.useEffect(() => {
    if (auth?.loading || !auth?.session || auth.session.requirePasswordChange) {
      return;
    }
    schedulePostLoginPrefetch();
  }, [auth?.loading, auth?.session?.sessionToken, auth?.session?.requirePasswordChange]);

  React.useEffect(() => {
    const loadModes = async () => {
      if (!auth?.session) {
        setEnabledServiceModes(getDefaultServiceModes().filter((mode) => mode.enabled));
        setServiceModesLoaded(false);
        return;
      }
      try {
        const modes = await getEnabledServiceModes();
        setEnabledServiceModes(
          modes.length ? modes : getDefaultServiceModes().filter((m) => m.enabled),
        );
        setServiceModesLoaded(true);
      } catch {
        setEnabledServiceModes(getDefaultServiceModes().filter((m) => m.enabled));
        setServiceModesLoaded(true);
      }
    };
    loadModes();
    window.addEventListener("service-modes-changed", loadModes);
    return () => window.removeEventListener("service-modes-changed", loadModes);
  }, [auth?.session?.sessionToken]);

  React.useEffect(() => {
    if (!hasTableMode && page === "tables") {
      setPage(fallbackPage);
      window.location.hash = fallbackPage === "billing" ? "#billing" : "#kot";
    }
  }, [hasTableMode, page, fallbackPage]);

  React.useEffect(() => {
    const onHash = () => {
      const hashPageMap: Record<string, Page> = {
        "#billing": "billing",
        "#customers": "customers",
        "#tables": "tables",
        "#kot": "kot",
        "#manager": "manager",
      };
      const sectionTarget = managerSectionFromHash(window.location.hash);
      if (sectionTarget) {
        if (canOpenManager(sectionTarget, window.location.hash)) {
          const role = auth?.session?.role as Role;
          setManagerSection(
            role
              ? resolveManagerSection(
                  reportsOnly ? "reports" : sectionTarget,
                  window.location.hash,
                  role,
                )
              : sectionTarget,
          );
          setPage("manager");
          return;
        }
        window.location.hash = fallbackPage === "billing" ? "#billing" : "#kot";
        setPage(fallbackPage);
        return;
      }
      const target = hashPageMap[window.location.hash];
      if (!target) {
        return;
      }
      if (effectiveAllowedPages.includes(target)) {
        setPage(target);
      } else {
        window.location.hash = fallbackPage === "billing" ? "#billing" : "#kot";
        setPage(fallbackPage);
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
  }, [effectiveAllowedPages, fallbackPage, reportsOnly, auth?.session?.role, perms]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("lastPage", page);
      const hash = {
        billing: "#billing",
        tables: "#tables",
        kot: "#kot",
        reports: "#reports",
        customers: "#customers",
        manager: MANAGER_SECTION_HASH[reportsOnly ? "reports" : managerSection],
      }[page];
      const currentHash = window.location.hash;
      const currentManagerSection = managerSectionFromHash(currentHash);
      const expectedSection = reportsOnly ? "reports" : managerSection;
      if (!(page === "manager" && currentManagerSection === expectedSection)) {
        window.location.hash = hash || (fallbackPage === "billing" ? "#billing" : "#kot");
      }
      // if navigating away from tables, hide inline billing
      if (page !== "tables") {
        setShowBillingInline(false);
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [page, managerSection, fallbackPage, reportsOnly]);

  // User menu (dropdown) state + outside click handler
  const userMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const closeProfile = React.useCallback(() => setProfileOpen(false), []);
  const profileDialogRef = useFocusTrap<HTMLDivElement>(profileOpen, closeProfile);
  const profileBackdrop = useBackdropDismiss(closeProfile);
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
    return <PageLoadingFallback variant="auth" label="Starting RestoNiti" />;
  }
  if (!auth?.session) {
    // First-run: no users exist, so show setup wizard instead of login.
    if (hasUsers === false) {
      return (
        <React.Suspense fallback={<PageLoadingFallback variant="auth" label="Preparing setup" />}>
          <SetupScreen onComplete={onSetupComplete} />
        </React.Suspense>
      );
    }
    return (
      <React.Suspense fallback={<PageLoadingFallback variant="auth" label="Loading sign-in" />}>
        <LoginScreen />
      </React.Suspense>
    );
  }
  // If the account requires a password change (e.g. freshly seeded admin),
  // gate access to the entire application until a new password is set.
  if (auth.session.requirePasswordChange) {
    return (
      <React.Suspense fallback={<PageLoadingFallback variant="auth" label="Loading account" />}>
        <ChangePasswordScreen />
      </React.Suspense>
    );
  }

  return (
    <div id="app-root" className="pos-shell">
      <a className="pos-skip-link" href="#main-content">
        Skip to content
      </a>
      <header id="app-header" className="pos-header">
        <div className="pos-brand-lockup">
          <img src={restoNitiMark} alt="" className="pos-brand-mark" />
          <div className="pos-brand-name">
            <span className="pos-brand-resto">Resto</span>
            <span className="pos-brand-niti">Niti</span>
          </div>
        </div>
        <nav id="main-nav" className="pos-nav" aria-label="Main navigation">
          {navItems
            .filter((n) => {
              if (n.k === "reports") {
                return reportsOnly;
              }
              return effectiveAllowedPages.includes(n.k);
            })
            .map((it) => {
              const active =
                it.k === "reports"
                  ? page === "manager" && managerSection === "reports"
                  : page === it.k;
              return (
                <button
                  key={it.k}
                  type="button"
                  className={`hdr-nav-btn${active ? " hdr-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() =>
                    prefetchForPage(it.k === "reports" ? "manager" : (it.k as Page))
                  }
                  onFocus={() => prefetchForPage(it.k === "reports" ? "manager" : (it.k as Page))}
                  onClick={() => {
                    if (it.k === "reports") {
                      setManagerSection("reports");
                      setPage("manager");
                      window.location.hash = "#reports";
                      return;
                    }
                    if (it.k === "manager") {
                      const role = auth?.session?.role as Role | undefined;
                      const next = role ? getDefaultManageSection(role) : "overview";
                      setManagerSection(next);
                      setPage("manager");
                      window.location.hash = MANAGER_SECTION_HASH[next];
                      return;
                    }
                    setPage(it.k as Page);
                    window.location.hash = `#${it.k}`;
                  }}
                >
                  <Icon icon={it.icon} size="sm" />
                  <span className="hdr-nav-label">{it.t}</span>
                </button>
              );
            })}
        </nav>
        <div className="pos-header-end">
          <GatewayChip />
          <div className="pos-clock">
            <div className="pos-clock-dot" aria-label="Online" />
            <div>
              <div className="pos-clock-time">
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="pos-clock-date">
                {now.toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </div>
            </div>
          </div>
          <div ref={userMenuRef as any} className="pos-user-menu">
            <button
              className="hdr-user-btn"
              onClick={() => setUserMenuOpen((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={[
                auth.session.displayName || auth.session.username,
                branding.hotelName || auth.session.role,
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <div className="pos-avatar">
                {(auth.session.displayName || auth.session.username).charAt(0).toUpperCase()}
              </div>
              <div className="pos-user-meta">
                <div className="pos-user-name">
                  {auth.session.displayName || auth.session.username}
                </div>
                <div className="pos-user-outlet">{branding.hotelName || auth.session.role}</div>
              </div>
            </button>
            {userMenuOpen && (
              <div className="hdr-dropdown" role="menu">
                {branding.hotelName ? (
                  <div className="hdr-dd-meta" role="presentation">
                    <div className="hdr-dd-meta-label">Outlet</div>
                    <div className="hdr-dd-meta-value">{branding.hotelName}</div>
                    <div className="hdr-dd-meta-role">{auth.session.role}</div>
                  </div>
                ) : null}
                {branding.hotelName ? <div className="hdr-dd-sep" /> : null}
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
      </header>

      <div id="main-content" tabIndex={-1} className="pos-main-content">
        <React.Suspense fallback={screenFallbackForPage(page)}>
          {inlineLayout ? (
            <div id="split-view" className="pos-split-view">
              <main id="tables-section" className="pos-tables-section">
                <Tables />
              </main>
              <aside id="billing-section" className="pos-billing-section">
                <Billing />
              </aside>
            </div>
          ) : (
            <>
              <main className="pos-main-pane">
                {page === "tables" && effectiveAllowedPages.includes("tables") && <Tables />}
                {page === "billing" && effectiveAllowedPages.includes("billing") && <Billing />}
                {page === "kot" && effectiveAllowedPages.includes("kot") && <KOTQueue />}
                {page === "customers" && effectiveAllowedPages.includes("customers") && (
                  <Customers />
                )}
                {page === "manager" && auth?.session?.role
                  ? (() => {
                      const role = auth.session!.role as Role;
                      const safeSection = resolveManagerSection(
                        reportsOnly ? "reports" : managerSection,
                        typeof window !== "undefined" ? window.location.hash : "",
                        role,
                      );
                      return (
                        <Manager
                          section={safeSection}
                          reportsOnly={reportsOnly}
                          allowedManageSections={perms.allowedManageSections}
                          allowedPeopleTabs={perms.allowedPeopleTabs}
                          onSectionChange={(section) => {
                            if (reportsOnly && section !== "reports") {
                              return;
                            }
                            const next = resolveManagerSection(section, window.location.hash, role);
                            setManagerSection(next);
                            setPage("manager");
                          }}
                        />
                      );
                    })()
                  : null}
              </main>
            </>
          )}
        </React.Suspense>
      </div>

      {profileOpen && (
        <div className="ui-overlay" {...profileBackdrop}>
          <div
            ref={profileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profileDialogTitle"
            tabIndex={-1}
            className="ui-dialog"
          >
            <div className="pos-profile-head">
              <h3 id="profileDialogTitle" className="pos-profile-title">
                My Profile
              </h3>
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={closeProfile}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="pos-profile-identity">
              <div className="pos-avatar pos-profile-avatar">
                {(auth?.session?.username?.[0] ?? "?").toUpperCase()}
              </div>
              <div>
                <div className="pos-profile-name">
                  {auth?.session?.displayName || auth?.session?.username || "—"}
                </div>
                {branding.hotelName ? (
                  <div className="pos-profile-outlet">{branding.hotelName}</div>
                ) : null}
                <div className="pos-profile-role">{auth?.session?.role ?? "—"}</div>
              </div>
            </div>
            {auth?.session?.sessionStart && (
              <div className="pos-profile-session">
                Session started: {new Date(auth.session.sessionStart).toLocaleString("en-IN")}
              </div>
            )}
            <button
              type="button"
              className="ui-btn ui-btn-danger pos-profile-logout"
              onClick={() => {
                closeProfile();
                auth?.logout();
              }}
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [licenseState, setLicenseState] = React.useState<
    "loading" | "licensed" | "unlicensed"
  >("loading");
  const [unlicensed, setUnlicensed] = React.useState<{
    status: "unlicensed";
    message?: string;
    supportDetail?: string | null;
  }>({ status: "unlicensed" });

  const refreshLicense = React.useCallback(() => {
    const api = window.pos?.license;
    if (!window.pos) {
      setLicenseState("licensed");
      return;
    }
    if (!api?.getStatus) {
      setUnlicensed({
        status: "unlicensed",
        message: "This license could not be verified.",
      });
      setLicenseState("unlicensed");
      return;
    }
    api
      .getStatus()
      .then((status) => {
        if (status.status === "licensed") {
          setLicenseState("licensed");
          return;
        }
        setUnlicensed({
          status: "unlicensed",
          message: status.message,
          supportDetail: status.supportDetail,
        });
        setLicenseState("unlicensed");
      })
      .catch(() => {
        setUnlicensed({
          status: "unlicensed",
          message: "This license could not be verified.",
        });
        setLicenseState("unlicensed");
      });
  }, []);

  React.useEffect(() => {
    refreshLicense();
  }, [refreshLicense]);

  if (licenseState === "loading") {
    return (
      <ErrorBoundary>
        <PageLoadingFallback variant="auth" label="Starting RestoNiti" />
      </ErrorBoundary>
    );
  }
  if (licenseState === "unlicensed") {
    return (
      <ErrorBoundary>
        <Activation initialStatus={unlicensed} onActivated={refreshLicense} />
      </ErrorBoundary>
    );
  }

  return <LicensedApp />;
}

function LicensedApp() {
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

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <MainContent hasUsers={hasUsers} onSetupComplete={() => setHasUsers(true)} />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
