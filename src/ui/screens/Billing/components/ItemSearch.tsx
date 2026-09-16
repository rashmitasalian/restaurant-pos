import React from "react";
import styles from "../Billing.module.css";

// ── Fuzzy match logic ───────────────────────────────────────────────────────

interface MatchResult {
  score: number;
  parts: { text: string; match: boolean }[];
}

export interface SearchResult {
  item: any;
  score: number;
  parts: { text: string; match: boolean }[];
}

function getItemPriceLabel(item: any) {
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  if (!variants.length) {
    return `₹${item?.price ?? 0}`;
  }
  const prices = variants
    .map((variant: any) => Number(variant?.price))
    .filter((price: number) => Number.isFinite(price) && price > 0);
  if (!prices.length) {
    return `₹${item?.price ?? 0}`;
  }
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (minPrice === maxPrice) {
    return `₹${minPrice}`;
  }
  return `₹${minPrice} - ₹${maxPrice}`;
}

function computeMatchData(it: any, q: string): MatchResult | null {
  const hayName = (it.name || "").toLowerCase();
  const haySku = (it.sku || "").toLowerCase();
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  let score = 0;
  const matches: { start: number; end: number }[] = [];

  for (const t of tokens) {
    const idxName = hayName.indexOf(t);
    const idxSku = haySku.indexOf(t);
    if (idxName >= 0) {
      score += Math.max(50, 200 - idxName);
      matches.push({ start: idxName, end: idxName + t.length });
    } else if (idxSku >= 0) {
      score += 80;
      matches.push({ start: -1, end: -1 });
    } else {
      return null;
    }
  }

  if (hayName === q.toLowerCase()) {
    score += 200;
  }

  const merged: { start: number; end: number }[] = [];
  for (const m of matches.filter((m) => m.start >= 0).sort((a, b) => a.start - b.start)) {
    if (!merged.length) {
      merged.push({ ...m });
    } else {
      const last = merged[merged.length - 1];
      if (m.start <= last.end) {
        last.end = Math.max(last.end, m.end);
      } else {
        merged.push({ ...m });
      }
    }
  }

  const parts: { text: string; match: boolean }[] = [];
  if (merged.length === 0) {
    parts.push({ text: it.name || "", match: false });
  } else {
    let ptr = 0;
    for (const mm of merged) {
      if (ptr < mm.start) {
        parts.push({ text: (it.name || "").slice(ptr, mm.start), match: false });
      }
      parts.push({ text: (it.name || "").slice(mm.start, mm.end), match: true });
      ptr = mm.end;
    }
    if (ptr < (it.name || "").length) {
      parts.push({ text: (it.name || "").slice(ptr), match: false });
    }
  }

  return { score, parts };
}

// ── Component ───────────────────────────────────────────────────────────────

interface ItemSearchProps {
  items: any[];
  onSelect: (item: any) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function ItemSearch({ items, onSelect, inputRef }: ItemSearchProps) {
  const [query, setQuery] = React.useState("");
  const [filtered, setFiltered] = React.useState<SearchResult[]>([]);
  const [highlighted, setHighlighted] = React.useState(-1);
  const [showDropdown, setShowDropdown] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const localInputRef = React.useRef<HTMLInputElement | null>(null);
  const effectiveRef = inputRef || localInputRef;
  // Track whether the mouse is pressed on a dropdown item to prevent blur
  const selectingRef = React.useRef(false);

  // Search effect
  React.useEffect(() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      setFiltered([]);
      setHighlighted(-1);
      setShowDropdown(false);
      return;
    }

    const candidates = items
      .filter((it) => it.available !== false)
      .map((it) => {
        const md = computeMatchData(it, q);
        if (!md) {
          return null;
        }
        return { item: it, score: md.score, parts: md.parts };
      })
      .filter(Boolean) as SearchResult[];

    candidates.sort((a, b) => b.score - a.score);
    const sliced = candidates.slice(0, 10);
    setFiltered(sliced);
    setHighlighted(sliced.length ? 0 : -1);
    setShowDropdown(sliced.length > 0);
  }, [query, items]);

  const handleSelect = (f: SearchResult) => {
    onSelect(f.item);
    setQuery("");
    setFiltered([]);
    setHighlighted(-1);
    setShowDropdown(false);
    selectingRef.current = false;
    setTimeout(() => effectiveRef.current?.focus(), 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      setHighlighted((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      setHighlighted((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        handleSelect(filtered[highlighted]);
      } else if (filtered.length === 1) {
        handleSelect(filtered[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setFiltered([]);
      setHighlighted(-1);
      setShowDropdown(false);
    }
  };

  return (
    <div ref={wrapRef} className={styles.searchWrap}>
      <input
        ref={effectiveRef}
        value={query}
        onKeyDown={handleKeyDown}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => {
          // Delay closing so click on dropdown item fires first
          if (selectingRef.current) {
            return;
          }
          setTimeout(() => {
            if (!selectingRef.current) {
              setShowDropdown(false);
            }
          }, 150);
        }}
        onFocus={() => {
          if (filtered.length > 0) {
            setShowDropdown(true);
          }
        }}
        placeholder="Search…"
        className={styles.searchInput}
        aria-autocomplete="list"
        aria-controls="billing-autocomplete"
        aria-expanded={showDropdown}
      />

      {showDropdown && filtered.length > 0 && (
        <div id="billing-autocomplete" role="listbox" className={styles.autocomplete}>
          {filtered.map((f, idx) => (
            <div
              key={f.item._id}
              role="option"
              aria-selected={highlighted === idx}
              onMouseDown={() => {
                // Mark that we're in the process of selecting — prevents blur from closing
                selectingRef.current = true;
              }}
              onMouseUp={() => {
                handleSelect(f);
              }}
              onMouseEnter={() => setHighlighted(idx)}
              className={`${styles.autocompleteItem} ${
                highlighted === idx ? styles.autocompleteItemActive : ""
              }`}
            >
              <div>
                <div className={styles.itemTitle}>
                  {f.parts
                    ? f.parts.map((p, i) =>
                        p.match ? (
                          <span key={i} className={styles.matchHighlight}>
                            {p.text}
                          </span>
                        ) : (
                          <span key={i}>{p.text}</span>
                        ),
                      )
                    : f.item.name}
                  {f.item.sku && <small className={styles.skuSmall}>#{f.item.sku}</small>}
                </div>
                {Array.isArray(f.item.variants) && f.item.variants.length > 0 && (
                  <div className={styles.itemSub}>
                    {f.item.variants.length} option{f.item.variants.length !== 1 ? "s" : ""} ·{" "}
                    {getItemPriceLabel(f.item)} · tap to choose
                  </div>
                )}
                {(!Array.isArray(f.item.variants) || f.item.variants.length === 0) && (
                  <div className={styles.itemSub}>{getItemPriceLabel(f.item)}</div>
                )}
              </div>
              <div className={styles.autocompleteBadge}>#{idx + 1}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
