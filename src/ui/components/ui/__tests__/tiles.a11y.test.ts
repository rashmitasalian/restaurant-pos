import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuTile } from "../MenuTile";
import { FavoriteTile } from "../FavoriteTile";
import { TableTile } from "../TableTile";
import { OrderItemRow } from "../OrderItemRow";
import { StatusDot } from "../StatusDot";

describe("ui tile accessibility", () => {
  it("MenuTile exposes an accessible name and title for long names", () => {
    const html = renderToStaticMarkup(
      React.createElement(MenuTile, {
        name: "Chicken Hyderabadi Dum Biryani Family Pack",
        priceLabel: "₹380",
        meta: "Mains",
        onClick: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Add Chicken Hyderabadi Dum Biryani Family Pack, ₹380"');
    expect(html).toContain('title="Chicken Hyderabadi Dum Biryani Family Pack"');
    expect(html).toContain('type="button"');
  });

  it("FavoriteTile announces shortcut when present", () => {
    const html = renderToStaticMarkup(
      React.createElement(FavoriteTile, {
        name: "Butter Naan",
        priceLabel: "₹80",
        shortcut: 2,
        onClick: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Quick add Butter Naan, ₹80. Shortcut 2."');
    expect(html).toContain("[2]");
  });

  it("TableTile keeps Table N prefix and does not double-label StatusDot", () => {
    const html = renderToStaticMarkup(
      React.createElement(TableTile, {
        number: 12,
        state: "occupied",
        amountLabel: "₹840",
        elapsed: "12m",
        onClick: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Table 12, Occupied"');
    expect(html).toContain("Occupied");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/role="img"/);
  });

  it("OrderItemRow quantity controls have accessible names", () => {
    const html = renderToStaticMarkup(
      React.createElement(OrderItemRow, {
        title: "Paneer Tikka Masala with Butter Garlic Naan",
        rateLabel: "₹240 each",
        qty: 2,
        lineTotalLabel: "₹480",
        onDecrease: () => undefined,
        onIncrease: () => undefined,
        onStartEditQty: () => undefined,
        onStartEditRate: () => undefined,
        onQtyChange: () => undefined,
        onRateChange: () => undefined,
        onCommitQty: () => undefined,
        onCommitRate: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(html).toContain(
      'aria-label="Decrease quantity of Paneer Tikka Masala with Butter Garlic Naan"',
    );
    expect(html).toContain(
      'aria-label="Increase quantity of Paneer Tikka Masala with Butter Garlic Naan"',
    );
    expect(html).toContain('aria-label="Remove Paneer Tikka Masala with Butter Garlic Naan"');
  });

  it("StatusDot decorative mode hides from assistive tech", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusDot, {
        tone: "occupied",
        label: "Occupied",
        decorative: true,
      }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label="Occupied"');
  });
});
