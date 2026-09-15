import { canManageCustomerCredit, roleHasPermission } from "../permissions";
import { validationMessage } from "../validation";

describe("canManageCustomerCredit", () => {
  it("allows admin and manager only", () => {
    expect(canManageCustomerCredit("admin")).toBe(true);
    expect(canManageCustomerCredit("manager")).toBe(true);
    expect(canManageCustomerCredit("cashier")).toBe(false);
    expect(canManageCustomerCredit("captain")).toBe(false);
    expect(canManageCustomerCredit(null)).toBe(false);
  });

  it("matches the page:manager / system:settings capability split", () => {
    expect(roleHasPermission("manager", "page:manager")).toBe(true);
    expect(roleHasPermission("manager", "system:settings")).toBe(false);
    expect(roleHasPermission("admin", "system:settings")).toBe(true);
    expect(roleHasPermission("cashier", "page:manager")).toBe(false);
  });
});

describe("customer credit validation messages", () => {
  it("maps new credit ops errors", () => {
    expect(validationMessage("credit-manage-forbidden")).toMatch(/manager or admin/i);
    expect(validationMessage("credit-allocation-incomplete")).toMatch(/allocate/i);
    expect(validationMessage("credit-sale-not-found")).toMatch(/not found/i);
    expect(validationMessage("credit-sale-already-settled")).toMatch(/settled/i);
    expect(validationMessage("credit-void-reason-too-long")).toMatch(/500/i);
  });
});
