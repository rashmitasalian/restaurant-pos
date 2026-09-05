import type { MenuVariant } from "../types/menu";
import { formatPrice } from "../utils/formatPrice";

type VariantListProps = {
  variants: MenuVariant[];
};

export function VariantList({ variants }: VariantListProps) {
  return (
    <ul className="pm-variants">
      {variants.map((variant) => (
        <li key={variant.id} className="pm-variant">
          <span className="pm-variant-name">{variant.name}</span>
          <span className="pm-variant-price">{formatPrice(variant.price)}</span>
        </li>
      ))}
    </ul>
  );
}
