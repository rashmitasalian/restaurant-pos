import React from "react";
import { ChevronDown, ChevronLeft, Minus, Plus, Search, Star } from "lucide-react";
import { Icon } from "../../ui/components/ui/Icon";
import { money } from "../money";
import { CategorySheet } from "../sheets/CategorySheet";
import { TEXT_LIMITS } from "../../shared/textLimits";

const PINNED_NAMED_CATEGORIES = 2;

function lineMatchesItem(line: any, item: any) {
  const menuId = String(item?._id || "");
  if (menuId && String(line.menuItemId || "") === menuId) {
    return true;
  }
  return String(line.name || "") === String(item?.name || "");
}

function DietMark({ diet }: { diet?: string | null }) {
  if (diet !== "veg" && diet !== "non-veg" && diet !== "egg") {
    return null;
  }
  const label = diet === "veg" ? "Veg" : diet === "egg" ? "Egg" : "Non-veg";
  return <span className={`cap-diet cap-diet-${diet}`} title={label} aria-label={label} />;
}

function groupMenuItems(items: any[], categoryOrder: string[]) {
  const groups = new Map<string, any[]>();
  const uncategorized: any[] = [];
  const orderIndex = new Map(categoryOrder.map((name, index) => [name, index]));

  for (const item of items) {
    const category = String(item.category || "").trim();
    if (!category) {
      uncategorized.push(item);
      continue;
    }
    const list = groups.get(category) || [];
    list.push(item);
    groups.set(category, list);
  }

  const sections = [...groups.entries()]
    .sort((a, b) => {
      const left = orderIndex.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
      const right = orderIndex.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) {
        return left - right;
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([name, sectionItems]) => ({ name, items: sectionItems }));

  if (uncategorized.length) {
    sections.push({ name: "Other", items: uncategorized });
  }
  return sections;
}

function MenuItemRow({
  item,
  qty,
  busy,
  pending,
  flashed,
  onAddItem,
  onChangeQty,
  onFlash,
  primaryLineForItem,
}: {
  item: any;
  qty: number;
  busy: boolean;
  pending: boolean;
  flashed: boolean;
  onAddItem: (item: any) => void;
  onChangeQty: (line: any, nextQty: number) => void;
  onFlash: (id: string) => void;
  primaryLineForItem: (item: any) => any;
}) {
  const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
  return (
    <div
      className={`cap-menu-row ${flashed ? "cap-menu-tile-flash" : ""} ${qty > 0 ? "is-in-order" : ""}`}
    >
      <div className="cap-menu-row-copy">
        <p className="cap-menu-row-name">
          <DietMark diet={item.diet} />
          <span>{item.name}</span>
        </p>
        <span className="cap-menu-row-meta">
          {item.sku ? <span className="cap-menu-code">{item.sku}</span> : null}
          {money(Number(item.price || 0))}
          {hasVariants ? ` · ${item.variants.length} options` : ""}
        </span>
      </div>
      {hasVariants ? (
        <button
          type="button"
          className="cap-add-btn"
          disabled={busy && pending}
          aria-label={`Choose ${item.name} variant`}
          onClick={() => {
            onFlash(item._id);
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
              if (!line) {
                return;
              }
              onChangeQty(line, Number(line.qty || 0) - 1);
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
              onFlash(item._id);
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
            onFlash(item._id);
            onAddItem(item);
          }}
        >
          <Icon icon={Plus} size="md" />
        </button>
      )}
    </div>
  );
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
  onRegisterBack,
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
  onRegisterBack?: (handler: (() => boolean) | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [flashId, setFlashId] = React.useState<string | null>(null);

  const items: any[] = order?.items || [];
  const itemCount = items.reduce((sum: number, line: any) => sum + Number(line.qty || 0), 0);
  const unsentCount = items.reduce(
    (sum: number, line: any) =>
      sum + Math.max(0, Number(line.qty || 0) - Number(line.kotPrintedQty || 0)),
    0,
  );
  const orderTotal = Number(order?.total || 0);

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
      const q = query.trim().toLowerCase();
      const name = String(item.name || "").toLowerCase();
      const sku = String(item.sku || "").toLowerCase();
      return name.includes(q) || sku.includes(q);
    }
    return true;
  });

  const hasFavorites = menuItems.some((item) => item.favorite);
  const namedCategories = categories.filter(Boolean);
  const pinnedLimit = hasFavorites ? 1 : PINNED_NAMED_CATEGORIES;
  const showAllNamed = namedCategories.length <= PINNED_NAMED_CATEGORIES;
  const pinnedCategories = showAllNamed ? namedCategories : namedCategories.slice(0, pinnedLimit);
  const overflowCategories = showAllNamed ? [] : namedCategories.slice(pinnedLimit);
  const categoryInOverflow = overflowCategories.includes(category);
  const showGrouped = category === "all" && !query.trim();
  const sections = showGrouped
    ? groupMenuItems(filtered, namedCategories)
    : [{ name: "", items: filtered }];
  const showHeadings = showGrouped && sections.length > 1;

  const qtyForItem = (item: any) =>
    items
      .filter((line) => lineMatchesItem(line, item))
      .reduce((sum, line) => sum + Number(line.qty || 0), 0);

  const primaryLineForItem = (item: any) => {
    const matches = items.filter((line) => lineMatchesItem(line, item));
    const exact = matches.filter((line) => String(line.name || "") === String(item.name || ""));
    const pool = exact.length ? exact : matches;
    if (pool.length !== 1) {
      return null;
    }
    return pool[0];
  };

  React.useEffect(() => {
    onRegisterBack?.(() => {
      if (categoryOpen) {
        setCategoryOpen(false);
        return true;
      }
      return false;
    });
    return () => onRegisterBack?.(null);
  }, [categoryOpen, onRegisterBack]);

  React.useEffect(() => {
    if (!flashId) {
      return;
    }
    const timer = window.setTimeout(() => setFlashId(null), 280);
    return () => clearTimeout(timer);
  }, [flashId]);

  return (
    <div className={`cap-session${itemCount > 0 ? " cap-session-docked" : ""}`}>
      <header className="cap-session-top">
        <button type="button" className="cap-icon-btn" onClick={onBack} aria-label="Back to tables">
          <Icon icon={ChevronLeft} size="lg" />
        </button>
        <div className="cap-session-title">
          <strong>{tableName}</strong>
          <span>{itemCount ? `${itemCount} on this table` : "Add items"}</span>
        </div>
        {itemCount ? <div className="cap-session-total">{money(orderTotal)}</div> : null}
      </header>

      <div className="cap-session-tools">
        <label className="cap-search-wrap">
          <Icon icon={Search} size="md" />
          <input
            className="cap-search"
            placeholder="Search name or code"
            maxLength={TEXT_LIMITS.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search name or code"
          />
        </label>
        <div className="cap-cats cap-cats-pinned" role="tablist" aria-label="Menu categories">
          {hasFavorites ? (
            <button
              type="button"
              className={`cap-chip cap-chip-icon ${category === "favorites" ? "active" : ""}`}
              onClick={() => setCategory("favorites")}
              aria-label="Favorites"
              title="Favorites"
            >
              <Icon icon={Star} size="sm" />
            </button>
          ) : null}
          <button
            type="button"
            className={`cap-chip ${category === "all" ? "active" : ""}`}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {pinnedCategories.map((name) => (
            <button
              key={name}
              type="button"
              className={`cap-chip ${category === name ? "active" : ""}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
          {overflowCategories.length > 0 ? (
            <button
              type="button"
              className={`cap-chip ${categoryInOverflow ? "active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={categoryOpen}
              onClick={() => setCategoryOpen(true)}
            >
              <span>{categoryInOverflow ? category : "More"}</span>
              <Icon icon={ChevronDown} size="sm" />
            </button>
          ) : null}
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
          <div className="cap-menu-list">
            {sections.map((section) => (
              <section key={section.name || "all"} className="cap-menu-section">
                {showHeadings ? <div className="cap-area-title">{section.name}</div> : null}
                {section.items.map((item) => (
                  <MenuItemRow
                    key={item._id}
                    item={item}
                    qty={qtyForItem(item)}
                    busy={busy}
                    pending={addingItemId === item._id}
                    flashed={flashId === item._id}
                    onAddItem={onAddItem}
                    onChangeQty={onChangeQty}
                    onFlash={setFlashId}
                    primaryLineForItem={primaryLineForItem}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      )}

      {categoryOpen ? (
        <CategorySheet
          categories={overflowCategories}
          selected={categoryInOverflow ? category : ""}
          onSelect={(name) => {
            setCategory(name);
            setCategoryOpen(false);
          }}
          onClose={() => setCategoryOpen(false)}
        />
      ) : null}

      {itemCount > 0 ? (
        <button type="button" className="cap-order-dock" onClick={onReview}>
          <span>
            {itemCount} item{itemCount !== 1 ? "s" : ""} · {money(orderTotal)}
          </span>
          <span className="cap-order-dock-cta">
            {unsentCount > 0 ? "Review & send" : "Review"}
            {unsentCount > 0 ? <span className="cap-dock-bubble">{unsentCount}</span> : null}
          </span>
        </button>
      ) : null}
    </div>
  );
}
