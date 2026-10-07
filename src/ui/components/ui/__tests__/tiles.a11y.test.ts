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
    const veg = renderToStaticMarkup(
      React.createElement(MenuTile, {
        name: "Paneer Butter Masala",
        priceLabel: "₹240",
        diet: "veg",
        onClick: () => undefined,
      }),
    );
    expect(veg).toContain('aria-label="Add Paneer Butter Masala, Veg, ₹240"');
    expect(veg).toContain("ui-diet-circle");
    const egg = renderToStaticMarkup(
      React.createElement(MenuTile, {
        name: "Egg Bhurji",
        priceLabel: "₹120",
        diet: "egg",
        onClick: () => undefined,
      }),
    );
    expect(egg).toContain('aria-label="Add Egg Bhurji, Egg, ₹120"');
    expect(egg).toContain("ui-diet-triangle");
    expect(egg).toContain(">Egg<");
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

  it("TableTile keeps Table N prefix, exposes title tooltip, and does not double-label StatusDot", () => {
    const html = renderToStaticMarkup(
      React.createElement(TableTile, {
        number: "Patio A1",
        state: "occupied",
        amountLabel: "₹840",
        elapsed: "12m",
        itemCount: 3,
        onClick: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Table Patio A1, Occupied"');
    expect(html).toContain('title="Patio A1"');
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

  it("OrderItemRow kitchen note has an accessible name while the line can still be sent", () => {
    const html = renderToStaticMarkup(
      React.createElement(OrderItemRow, {
        title: "Tea",
        rateLabel: "₹20 each",
        qty: 1,
        lineTotalLabel: "₹20",
        kitchenNote: "less oily",
        noteEditable: true,
        onCommitNote: () => undefined,
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
    expect(html).toContain('aria-label="Kitchen note for Tea"');
    expect(html).toContain('placeholder="Kitchen note"');
    expect(html).toContain('value="less oily"');
    expect(html).toContain('maxLength="80"');
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
