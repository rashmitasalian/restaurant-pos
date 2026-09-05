import React from "react";
import { getRestaurantMenu, type MenuQueryResult } from "../api/getRestaurantMenu";
import { CategoryNav } from "../components/CategoryNav";
import { MenuHeader } from "../components/MenuHeader";
import { MenuSection } from "../components/MenuSection";
import type { PublicMenuItem } from "../types/menu";

type PublicMenuProps = {
  slug: string | null;
};

type PageState = MenuQueryResult | { status: "loading" } | { status: "error"; message: string };

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function itemsByCategory(items: PublicMenuItem[], categoryId: string): PublicMenuItem[] {
  return items.filter((item) => item.categoryId === categoryId);
}

function formatUpdatedToday(): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date());
}

export function PublicMenu({ slug }: PublicMenuProps) {
  const [state, setState] = React.useState<PageState>({ status: "loading" });
  const [activeCategoryId, setActiveCategoryId] = React.useState("all");

  React.useEffect(() => {
    if (!slug) {
      setState({ status: "not-found" });
      return;
    }

    try {
      setState(getRestaurantMenu(slug));
    } catch {
      setState({ status: "error", message: "This menu is unavailable right now." });
    }
  }, [slug]);

  const scrollToCategory = React.useCallback((id: string) => {
    setActiveCategoryId(id);
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (id === "all") {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const section = document.getElementById(`category-${id}`);
    section?.scrollIntoView({ behavior, block: "start" });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="pm-page">
        <div className="pm-shell">
          <main className="pm-status" aria-busy="true">
            <p className="pm-status-title">Loading menu</p>
            <p className="pm-status-copy">Just a moment.</p>
          </main>
        </div>
      </div>
    );
  }

  if (state.status === "not-found" || state.status === "error") {
    return (
      <div className="pm-page">
        <div className="pm-shell">
          <main className="pm-status">
            <p className="pm-status-kicker">RestoNiti</p>
            <h1 className="pm-status-title">Restaurant not found</h1>
            <p className="pm-status-copy">
              {state.status === "error"
                ? state.message
                : "This menu is unavailable or the link may be incorrect."}
            </p>
          </main>
        </div>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="pm-page">
        <div className="pm-shell">
          <MenuHeader restaurant={state.restaurant} />
          <main className="pm-status">
            <h2 className="pm-status-title">Menu currently unavailable</h2>
            <p className="pm-status-copy">Please check back shortly.</p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page">
      <div className="pm-shell">
        <MenuHeader restaurant={state.restaurant} />
        <CategoryNav
          categories={state.categories}
          activeId={activeCategoryId}
          onSelect={scrollToCategory}
        />
        <main className="pm-main">
          {state.categories.map((category) => (
            <MenuSection
              key={category.id}
              category={category}
              items={itemsByCategory(state.items, category.id)}
            />
          ))}
        </main>
        <footer className="pm-footer">
          <p>Menu updated {formatUpdatedToday()}</p>
          <p>Powered by RestoNiti</p>
        </footer>
      </div>
    </div>
  );
}
