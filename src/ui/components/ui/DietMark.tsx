import React from "react";
import { dietName } from "../../../shared/menuDiet";

export function DietMark({
  diet,
  decorative = false,
}: {
  diet?: string | null;
  decorative?: boolean;
}) {
  const label = dietName(diet);
  if (!label) {
    return null;
  }
  const nonVeg = diet === "non-veg" || diet === "egg";
  return (
    <span
      className={`ui-diet ${nonVeg ? "ui-diet-nonveg" : "ui-diet-veg"}`}
      title={label}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
    >
      <span className="ui-diet-box" aria-hidden="true">
        <span className={diet === "veg" ? "ui-diet-circle" : "ui-diet-triangle"} />
      </span>
      {diet === "egg" ? <span className="ui-diet-egg">Egg</span> : null}
    </span>
  );
}
