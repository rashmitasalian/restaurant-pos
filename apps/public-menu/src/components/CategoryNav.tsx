import type { MenuCategory } from "../types/menu";

type CategoryNavProps = {
  categories: MenuCategory[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function CategoryNav({ categories, activeId, onSelect }: CategoryNavProps) {
  return (
    <nav className="pm-nav" aria-label="Menu categories">
      <div className="pm-nav-scroller">
        <button
          type="button"
          className={`pm-nav-chip${activeId === "all" ? " is-active" : ""}`}
          aria-current={activeId === "all" ? "true" : undefined}
          onClick={() => onSelect("all")}
        >
          All
        </button>
        {categories.map((category) => {
          const active = activeId === category.id;
          return (
            <button
              key={category.id}
              type="button"
              className={`pm-nav-chip${active ? " is-active" : ""}`}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(category.id)}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
