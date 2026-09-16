import { DEMO_MENUS } from "../data/menu";
import type { MenuCategory, PublicMenuItem, Restaurant } from "../types/menu";

export type MenuQueryResult =
  | {
      status: "success";
      restaurant: Restaurant;
      categories: MenuCategory[];
      items: PublicMenuItem[];
    }
  | { status: "empty"; restaurant: Restaurant }
  | { status: "not-found" };

export function getRestaurant(slug: string): Restaurant | null {
  return DEMO_MENUS[slug]?.restaurant ?? null;
}

export function getRestaurantMenu(slug: string): MenuQueryResult {
  const menu = DEMO_MENUS[slug];
  if (!menu) {
    return { status: "not-found" };
  }

  if (menu.items.length === 0) {
    return { status: "empty", restaurant: menu.restaurant };
  }

  return {
    status: "success",
    restaurant: menu.restaurant,
    categories: [...menu.categories].sort((a, b) => a.sortOrder - b.sortOrder),
    items: menu.items,
  };
}
