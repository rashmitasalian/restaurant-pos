import type { MenuCategory, PublicMenuItem } from "../types/menu";
import { MenuItem } from "./MenuItem";

type MenuSectionProps = {
  category: MenuCategory;
  items: PublicMenuItem[];
};

export function MenuSection({ category, items }: MenuSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="pm-section" id={`category-${category.id}`} aria-labelledby={`heading-${category.id}`}>
      <h2 className="pm-section-title" id={`heading-${category.id}`}>
        {category.name}
      </h2>
      <div className="pm-section-list">
        {items.map((item) => (
          <MenuItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
