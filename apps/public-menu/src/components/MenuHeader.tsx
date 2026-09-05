import type { Restaurant } from "../types/menu";

type MenuHeaderProps = {
  restaurant: Restaurant;
};

export function MenuHeader({ restaurant }: MenuHeaderProps) {
  return (
    <header className="pm-header">
      {restaurant.logoUrl ? (
        <img className="pm-logo" src={restaurant.logoUrl} alt={`${restaurant.name} logo`} />
      ) : (
        <div className="pm-logo-mark" aria-hidden="true">
          R
        </div>
      )}
      <h1 className="pm-title">{restaurant.name}</h1>
      {restaurant.tagline ? <p className="pm-tagline">{restaurant.tagline}</p> : null}
      {restaurant.address || restaurant.phone ? (
        <p className="pm-meta">
          {restaurant.address}
          {restaurant.address && restaurant.phone ? " · " : null}
          {restaurant.phone ? (
            <a className="pm-phone" href={`tel:${restaurant.phone.replace(/\s+/g, "")}`}>
              {restaurant.phone}
            </a>
          ) : null}
        </p>
      ) : null}
    </header>
  );
}
