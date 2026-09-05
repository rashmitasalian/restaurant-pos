export interface Restaurant {
  slug: string;
  name: string;
  tagline?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface MenuVariant {
  id: string;
  name: string;
  price: number;
}

export interface PublicMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  available: boolean;
  vegetarian?: boolean;
  spicy?: boolean;
  variants?: MenuVariant[];
}

export interface RestaurantMenu {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: PublicMenuItem[];
}
