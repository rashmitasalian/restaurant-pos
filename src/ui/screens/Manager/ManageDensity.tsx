import React from "react";

export type ManageDensity = "comfortable" | "compact";

type ManageDensityContextValue = {
  density: ManageDensity;
  setDensity: (next: ManageDensity) => void;
  dense: boolean;
};

const ManageDensityContext = React.createContext<ManageDensityContextValue | null>(null);

const STORAGE_KEY = "manageDensity";

export function ManageDensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = React.useState<ManageDensity>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });

  const setDensity = React.useCallback((next: ManageDensity) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = React.useMemo(
    () => ({ density, setDensity, dense: density === "compact" }),
    [density, setDensity],
  );

  return (
    <ManageDensityContext.Provider value={value}>
      <div data-manage-density={density} className={density === "compact" ? "manage-dense" : undefined}>
        {children}
      </div>
    </ManageDensityContext.Provider>
  );
}

export function useManageDensity() {
  const ctx = React.useContext(ManageDensityContext);
  if (!ctx) {
    return {
      density: "comfortable" as ManageDensity,
      setDensity: () => undefined,
      dense: false,
    };
  }
  return ctx;
}
