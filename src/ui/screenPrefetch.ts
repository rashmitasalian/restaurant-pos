/** Lazy import loaders — shared by React.lazy and background prefetch. */
export const screenImports = {
  tables: () => import("./screens/Tables/Tables"),
  billing: () => import("./screens/Billing/Billing"),
  kot: () => import("./screens/KOTQueue/KOTQueue"),
  customers: () => import("./screens/Customers/Customers"),
  manager: () => import("./screens/Manager/Manager"),
  login: () => import("./screens/Login/LoginScreen"),
  changePassword: () => import("./screens/Login/ChangePasswordScreen"),
  setup: () => import("./screens/Login/SetupScreen"),
} as const;

export type ScreenPrefetchKey = keyof typeof screenImports;

const prefetched = new Set<string>();

export function prefetchScreen(key: ScreenPrefetchKey) {
  if (prefetched.has(key)) {
    return;
  }
  prefetched.add(key);
  void screenImports[key]().catch(() => {
    prefetched.delete(key);
  });
}

/** Warm likely next screens while the shell is idle after sign-in. */
export function prefetchPostLoginScreens() {
  prefetchScreen("billing");
  prefetchScreen("tables");
  prefetchScreen("manager");
  prefetchScreen("kot");
  prefetchScreen("customers");
  void import("./screens/Manager/Overview").catch(() => undefined);
}

export function schedulePostLoginPrefetch() {
  const run = () => prefetchPostLoginScreens();
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 120);
  }
}
