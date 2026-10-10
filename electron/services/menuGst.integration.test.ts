jest.mock("electron", () => ({
  app: {
    getPath: () => process.env.POS_TEST_USER_DATA_DIR || "",
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb, initializeDatabase } from "../db/sqlite";
import { posService } from "./posService";

const GSTIN = "29ABCDE1234F1Z5";

function gstConfig(rateBps: number, priceIncludesTax = false) {
  return {
    enabled: true,
    gstin: GSTIN,
    legalName: "RestoNiti",
    registeredAddress: "MG Road",
    stateCode: "29",
    stateName: "Karnataka",
    gstRateBps: rateBps,
    priceIncludesTax,
  };
}

describe("menu GST, order, and import", () => {
  let tempDir = "";

  beforeEach(async () => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-menu-gst-"));
    process.env.POS_TEST_USER_DATA_DIR = tempDir;
    process.env.POS_DB_PATH_OVERRIDE = path.join(tempDir, "restaurant-pos.sqlite");
    await initializeDatabase();
  });

  afterEach(() => {
    closeDb();
    delete process.env.POS_TEST_USER_DATA_DIR;
    delete process.env.POS_DB_PATH_OVERRIDE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores the cheapest variant, bills the chosen variant, and keeps that rate", () => {
    const item = posService.createItem({
      name: "Pizza",
      category: "Pizza",
      price: 1,
      diet: "veg",
      variants: [
        { name: "Half", price: 180 },
        { name: "Full", price: 300 },
      ],
    });
    const stored = getDb()
      .prepare("SELECT price_paise, tax_rate_bps, diet FROM menu_items WHERE id = ?")
      .get(item._id) as { price_paise: number; tax_rate_bps: number | null; diet: string };
    expect(stored.price_paise).toBe(18000);
    expect(stored.tax_rate_bps).toBeNull();
    expect(stored.diet).toBe("veg");
    expect(item.price).toBe(180);

    const order = posService.createOrder({ orderType: "takeaway" });
    posService.addItemToOrder(order._id, {
      name: "Pizza (Full)",
      qty: 1,
      rate: 300,
      menuItemId: item._id,
      categoryName: "Pizza",
    });
    const line = getDb()
      .prepare("SELECT rate_paise, tax_rate_bps, line_total_paise FROM order_lines WHERE order_id = ?")
      .get(order._id) as { rate_paise: number; tax_rate_bps: number | null; line_total_paise: number };
    expect(line.rate_paise).toBe(30000);
    expect(line.line_total_paise).toBe(30000);
    expect(line.tax_rate_bps).toBeNull();

    posService.updateItem({
      ...item,
      price: 180,
      variants: (item.variants || []).map((variant) =>
        variant.name === "Full" ? { ...variant, price: 350 } : variant,
      ),
    });
    const after = getDb()
      .prepare("SELECT rate_paise, line_total_paise FROM order_lines WHERE order_id = ?")
      .get(order._id) as { rate_paise: number; line_total_paise: number };
    expect(after.rate_paise).toBe(30000);
    expect(after.line_total_paise).toBe(30000);
    expect(
      getDb().prepare("SELECT price_paise FROM menu_items WHERE id = ?").get(item._id),
    ).toMatchObject({ price_paise: 18000 });
  });

  it("freezes the GST snapshot at payment and reports the stored tax", () => {
    posService.setSetting("config:gst", gstConfig(500));
    const tea = posService.createItem({ name: "Tea", category: "Drinks", price: 1000 });
    const first = posService.createOrder({ orderType: "takeaway" });
    posService.addItemToOrder(first._id, {
      name: "Tea",
      qty: 1,
      rate: 1000,
      menuItemId: tea._id,
    });
    const paidAtFive = posService.setOrderPaid(first._id, { method: "cash", amount: 1050 });
    expect(paidAtFive.taxTotal).toBe(50);
    expect(paidAtFive.meta?.gstSnapshot).toMatchObject({
      gstRateBps: 500,
      priceIncludesTax: false,
    });

    const open = posService.createOrder({ orderType: "takeaway" });
    posService.addItemToOrder(open._id, {
      name: "Tea",
      qty: 1,
      rate: 1000,
      menuItemId: tea._id,
    });
    posService.setSetting("config:gst", gstConfig(1800));
    const openAfter = posService.getOrderById(open._id)!;
    expect(openAfter.taxTotal).toBe(180);
    const paidAtEighteen = posService.setOrderPaid(open._id, { method: "cash", amount: 1180 });
    expect(paidAtEighteen.taxTotal).toBe(180);
    expect(paidAtEighteen.meta?.gstSnapshot).toMatchObject({ gstRateBps: 1800 });

    posService.setSetting("config:gst", gstConfig(500));
    const historical = posService.getOrderById(first._id)!;
    const later = posService.getOrderById(open._id)!;
    expect(historical.taxTotal).toBe(50);
    expect(historical.meta?.gstSnapshot).toMatchObject({ gstRateBps: 500 });
    expect(later.taxTotal).toBe(180);
    expect(later.meta?.gstSnapshot).toMatchObject({ gstRateBps: 1800 });

    const facts = posService.getSalesFacts({ from: 0, to: Date.now() + 1000 });
    expect(facts.gst.totalTax).toBe(230);
    const pizzaLine = facts.items.find((row) => row.itemName === "Tea");
    expect(pizzaLine?.netSales).toBe(2000);

    const next = posService.createOrder({ orderType: "takeaway" });
    posService.addItemToOrder(next._id, {
      name: "Tea",
      qty: 1,
      rate: 1000,
      menuItemId: tea._id,
    });
    expect(posService.getOrderById(next._id)?.taxTotal).toBe(50);
  });

  it("sorts categories and items by order, name, then id", () => {
    posService.setCategories(["Zebra", "Apple"]);
    posService.createItem({ name: "Beta", category: "Apple", price: 10, sortOrder: 1 });
    posService.createItem({ name: "Alpha", category: "Apple", price: 10, sortOrder: 1 });
    posService.createItem({ name: "Late", category: "Zebra", price: 10, sortOrder: 2 });
    posService.createItem({ name: "Early", category: "Zebra", price: 10, sortOrder: 1 });

    expect(posService.getCategories()).toEqual(["Zebra", "Apple"]);
    expect(posService.getItems().map((item) => `${item.category}:${item.name}`)).toEqual([
      "Zebra:Early",
      "Zebra:Late",
      "Apple:Alpha",
      "Apple:Beta",
    ]);
  });

  it("replaces the menu without deleting an item that is already on an order", () => {
    const biryani = posService.createItem({
      name: "Biryani",
      sku: "BIR001",
      category: "Mains",
      price: 200,
    });
    const soup = posService.createItem({ name: "Soup", category: "Mains", price: 80 });
    posService.createItem({ name: "Tea", category: "Drinks", price: 20 });
    const order = posService.createOrder({ orderType: "takeaway" });
    posService.addItemToOrder(order._id, {
      name: "Soup",
      qty: 1,
      rate: 80,
      menuItemId: soup._id,
      categoryName: "Mains",
    });

    const csv = [
      "category,category_order,item,item_order,sku,price,available,favorite,diet,variant,variant_price",
      "Mains,1,Biryani,1,BIR999,220,yes,no,non-veg,,",
      'Mains,1,"Chicken, Special",2,, ,yes,no,non-veg,Half,180',
      'Mains,1,"Chicken, Special",2,, ,yes,no,non-veg,Full,300',
    ].join("\n");

    const result = posService.importMenu(
      { csv, fileName: "menu.csv", mode: "replace" },
      "owner",
    );
    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(result.deactivatedItems).toBe(2);
    expect(result.deactivatedCategories).toBe(1);
    expect(result.fileName).toBe("menu.csv");

    const kept = posService.getItemById(biryani._id)!;
    expect(kept.sku).toBe("BIR999");
    expect(kept.price).toBe(220);
    expect(posService.getCategories()).toEqual(["Mains"]);
    const soupRow = getDb()
      .prepare("SELECT active FROM menu_items WHERE id = ?")
      .get(soup._id) as { active: number };
    expect(soupRow.active).toBe(0);
    const line = getDb()
      .prepare("SELECT menu_item_id, rate_paise FROM order_lines WHERE order_id = ?")
      .get(order._id) as { menu_item_id: string; rate_paise: number };
    expect(line.menu_item_id).toBe(soup._id);
    expect(line.rate_paise).toBe(8000);
    const special = posService.getItems().find((item) => item.name === "Chicken, Special");
    expect(special?.price).toBe(180);
    expect(special?.variants?.map((variant) => variant.price).sort()).toEqual([180, 300]);

    const audit = getDb()
      .prepare("SELECT detail_json FROM audit_logs WHERE action = 'menu.imported'")
      .get() as { detail_json: string };
    expect(audit.detail_json).not.toContain("Chicken, Special");
    expect(JSON.parse(audit.detail_json).fileName).toBe("menu.csv");
  });

  it("adds and updates items by default without touching the rest of the menu", () => {
    posService.createItem({ name: "Soup", category: "Mains", price: 80 });
    posService.createItem({ name: "Biryani", sku: "BIR001", category: "Mains", price: 200 });
    posService.createItem({ name: "Tea", category: "Drinks", price: 20 });
    posService.setVariantOptions(["Regular"]);

    const csv = [
      "category,item,variant,price,diet,available,favorite,sku",
      "Mains,Kebab,,260,non-veg,,,",
      "Mains,Biryani,,220,non-veg,,,BIR001",
      "Desserts,Kulfi,Small,60,veg,,,",
      "Desserts,Kulfi,Large,90,veg,,,",
    ].join("\n");

    const result = posService.importMenu({ csv, fileName: "more.csv" }, "owner");
    expect(result.mode).toBe("upsert");
    expect(result.created).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.deactivatedItems).toBe(0);
    expect(result.deactivatedCategories).toBe(0);

    expect(posService.getCategories()).toEqual(["Mains", "Drinks", "Desserts"]);
    const names = posService
      .getItems()
      .filter((item) => item.category === "Mains")
      .map((item) => [item.name, item.price]);
    expect(names).toEqual([
      ["Soup", 80],
      ["Biryani", 220],
      ["Kebab", 260],
    ]);
    expect(posService.getItems().map((item) => item.name)).toContain("Tea");
    expect(posService.getVariantOptions()).toEqual(["Regular", "Small", "Large"]);
  });

  it("updates an item that already owns the id when the file puts it in another category", () => {
    const tea = posService.createItem({ name: "Tea", category: "Drinks", price: 20 });
    const csv = [
      "category,item,variant,price,diet,available,favorite,sku",
      "Hot Beverages,Tea,,25,veg,yes,,",
    ].join("\n");

    const result = posService.importMenu({ csv, fileName: "vatika.csv" }, "owner");

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    const saved = posService.getItemById(tea._id)!;
    expect(saved.category).toBe("Hot Beverages");
    expect(saved.price).toBe(25);
    expect(posService.getItems().filter((item) => item.name === "Tea")).toHaveLength(1);
  });

  it("reorders items within a category", () => {
    const soup = posService.createItem({ name: "Soup", category: "Mains", price: 80 });
    const kebab = posService.createItem({ name: "Kebab", category: "Mains", price: 260 });
    const tikka = posService.createItem({ name: "Tikka", category: "Mains", price: 220 });

    expect(posService.reorderItems([tikka._id, soup._id, kebab._id])).toEqual({ ok: true, count: 3 });
    expect(posService.getItems().map((item) => item.name)).toEqual(["Tikka", "Soup", "Kebab"]);
  });

  it("does not write when the CSV is invalid", () => {
    const tea = posService.createItem({ name: "Tea", category: "Drinks", price: 20 });
    const csv = [
      "category,category_order,item,item_order,sku,price,available,favorite,diet,variant,variant_price",
      "Drinks,1,Tea,1,,25,yes,no,,,Full,30",
    ].join("\n");
    expect(() => posService.importMenu({ csv, fileName: "bad.csv" })).toThrow("menu-import-invalid");
    expect(posService.getItemById(tea._id)?.price).toBe(20);
    expect(posService.getCategories()).toEqual(["Drinks"]);
  });
});
