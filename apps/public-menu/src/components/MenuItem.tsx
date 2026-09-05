import type { PublicMenuItem } from "../types/menu";
import { formatPrice } from "../utils/formatPrice";
import { VariantList } from "./VariantList";

type MenuItemProps = {
  item: PublicMenuItem;
};

export function MenuItem({ item }: MenuItemProps) {
  const hasVariants = Boolean(item.variants && item.variants.length > 0);
  const dietLabel = item.vegetarian === true ? "Veg" : item.vegetarian === false ? "Non-Veg" : null;

  return (
    <article className={`pm-item${item.available ? "" : " is-unavailable"}`}>
      <div className="pm-item-top">
        <h3 className="pm-item-name">{item.name}</h3>
        {!hasVariants ? <p className="pm-item-price">{formatPrice(item.price)}</p> : null}
      </div>
      {item.available ? (
        item.description ? <p className="pm-item-desc">{item.description}</p> : null
      ) : (
        <p className="pm-item-unavailable">Currently unavailable</p>
      )}
      {hasVariants && item.variants ? <VariantList variants={item.variants} /> : null}
      {dietLabel || item.spicy ? (
        <p className="pm-item-flags">
          {dietLabel ? (
            <span className={`pm-diet ${item.vegetarian ? "is-veg" : "is-nonveg"}`}>
              <span className="pm-diet-dot" aria-hidden="true" />
              {dietLabel}
            </span>
          ) : null}
          {item.spicy ? <span className="pm-spicy">Spicy</span> : null}
        </p>
      ) : null}
    </article>
  );
}
