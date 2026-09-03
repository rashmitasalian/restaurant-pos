import React from "react";
import { ChevronLeft, Minus, Plus, Search, Star } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { money } from "../money";

function categoryMarkIndex(category: string) {
  const text = String(category || "M");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash + text.charCodeAt(i) * (i + 1)) % 4;
  }
  return hash;
}

function lineMatchesItem(line: any, item: any) {
  const menuId = String(item?._id || "");
  if (menuId && String(line.menuItemId || "") === menuId) {
    return true;
  }
  const name = String(item?.name || "");
  const lineName = String(line.name || "");
  return lineName === name || lineName.startsWith(`${name} (`);
}

export function MenuScreen({
  tableName,
  menuItems,
  categories,
  order,
  busy,
  addingItemId,
  onBack,
  onAddItem,
  onChangeQty,
  onReview,
}: {
  tableName: string;
  menuItems: any[];
  categories: string[];
  order: any;
  busy: boolean;
  addingItemId?: string | null;
  onBack: () => void;
  onAddItem: (item: any) => void;
  onChangeQty: (line: any, nextQty: number) => void;
  onReview: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [flashId, setFlashId] = React.useState<string | null>(null);

  const items: any[] = order?.items || [];
  const itemCount = items.reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0);
  const unsentCount = items.reduce(
    (sum: number, line: any) =>
      sum + Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0)),
    0,
  );
  const orderTotal = Number(order.total || 0);

  const filtered = menuItems.filter((item) => {
    if (item.available === false || item.active === false) {
      return false;
    }
    if (category === "favorites") {
      if (!item.favorite) {
        return false;
      }
    } else if (category !== "all" && String(item.category || "") !== category) {
      return false;
    }
    if (query.trim()) {
      return String(item.name || "")
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    }
    return true;
  });

  const hasFavorites = menuItems.some((item) => item.favorite);

  const qtyForItem = (item: any) =>
    items.filter((line) => lineMatchesItem(line, item)).reduce((sum, line) => sum + Number(line.qty || 0), 0);

  const primaryLineForItem = (item: any) => {
    const matches = items.filter((line) => lineMatchesItem(line, item));
    return (
      matches.find((line) => Number(line.qty || 0) > Number(line.kotPrintedQty || 0)) ||
      matches[matches.length - 1] ||
      null
    );
  };

  React.useEffect(() => {
    if (!flashId) {
      return;
    }
    const timer = window.setTimeout(() => setFlashId(null), 280);
    return () => clearTimeout(timer);
  }, [flashId]);

  return (
    <div className="cap-session">
      <header className="cap-session-top">
        <button type="button" className="cap-icon-btn" onClick={onBack} aria-label="Back to floor">
          <Icon icon={ChevronLeft} size="lg" />
        </button>
        <div className="cap-session-title">
          <strong>{tableName}</strong>
          <span>{itemCount ? `${itemCount} items` : "Add items"}</span>
        </div>
        <div className="cap-session-total">{money(orderTotal)}</div>
      </header>

      <div className="cap-session-tools">
        <label className="cap-search-wrap">
          <Icon icon={Search} size="md" />
          <input
            className="cap-search"
            placeholder="Search menu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="cap-cats" role="tablist" aria-label="Menu categories">
          {hasFavorites ? (
            <button
              type="button"
              className={`cap-chip ${category === "favorites" ? "active" : ""}`}
              onClick={() => setCategory("favorites")}
            >
              <Icon icon={Star} size="sm" />
              Favorites
            </button>
          ) : null}
          <button
            type="button"
            className={`cap-chip ${category === "all" ? "active" : ""}`}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`cap-chip ${category === name ? "active" : ""}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="cap-session-scroll">
          <div className="cap-empty">
            <strong>{query.trim() ? "No items match" : "No items"}</strong>
            {query.trim() ? (
              <button type="button" className="cap-text-btn" onClick={() => setQuery("")}>
                Clear search
              </button>
            ) : (
              <span>Menu is empty or still loading.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="cap-session-scroll">
          <div className="cap-menu-grid cap-menu-grid-2col">
          {filtered.map((item) => {
            const qty = qtyForItem(item);
            const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
            const mark = String(item.category || item.name || "M").charAt(0).toUpperCase();
            const pending = addingItemId === item._id;
            return (
              <div
                key={item._id}
                className={`cap-menu-tile ${flashId === item._id ? "cap-menu-tile-flash" : ""} ${qty > 0 ? "cap-menu-tile-in-cart" : ""}`}
              >
                <div className="cap-menu-tile-head">
                  <span className={`cap-menu-mark cap-menu-mark-${categoryMarkIndex(item.category || item.name)}`}>
                    {mark}
                  </span>
                  {qty > 0 ? <span className="cap-qty-badge">{qty}</span> : null}
                </div>
                <p className="cap-menu-tile-name">{item.name}</p>
                <div className="cap-menu-tile-foot">
                  <span className="cap-menu-tile-price">{money(Number(item.price || 0))}</span>
                  {hasVariants ? (
                    <button
                      type="button"
                      className="cap-add-btn"
                      disabled={busy && pending}
                      aria-label={`Choose ${item.name} variant`}
                      onClick={() => {
                        setFlashId(item._id);
                        onAddItem(item);
                      }}
                    >
                      <Icon icon={Plus} size="md" />
                    </button>
                  ) : qty > 0 ? (
                    <div className="cap-qty cap-qty-compact">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Decrease ${item.name}`}
                        onClick={() => {
                          const line = primaryLineForItem(item);
                          if (line) {
                            onChangeQty(line, Number(line.qty || 0) - 1);
                          }
                        }}
                      >
                        <Icon icon={Minus} size="sm" />
                      </button>
                      <span>{qty}</span>
                      <button
                        type="button"
                        disabled={busy && pending}
                        aria-label={`Increase ${item.name}`}
                        onClick={() => {
                          setFlashId(item._id);
                          onAddItem(item);
                        }}
                      >
                        <Icon icon={Plus} size="sm" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cap-add-btn"
                      disabled={busy && pending}
                      aria-label={`Add ${item.name}`}
                      onClick={() => {
                        setFlashId(item._id);
                        onAddItem(item);
                      }}
                    >
                      <Icon icon={Plus} size="md" />
                    </button>
                  )}
                </div>
                {hasVariants ? (
                  <span className="cap-menu-tile-meta">{item.variants.length} variants</span>
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {itemCount > 0 ? (
        <button type="button" className="cap-order-dock" onClick={onReview}>
          <span>
            {itemCount} item{itemCount !== 1 ? "s" : ""} · {money(orderTotal)}
          </span>
          <span className="cap-order-dock-cta">
            Review
            {unsentCount > 0 ? <span className="cap-dock-bubble">{unsentCount}</span> : null}
          </span>
        </button>
      ) : null}
    </div>
  );
}
