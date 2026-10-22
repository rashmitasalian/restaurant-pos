import { roleHasPermission } from "./permissions";

describe("table action permissions", () => {
  it("gives merge and split to the desktop floor roles and not to captain", () => {
    for (const role of ["admin", "manager", "cashier"] as const) {
      expect(roleHasPermission(role, "order:merge-tables")).toBe(true);
      expect(roleHasPermission(role, "order:split-order")).toBe(true);
    }
    expect(roleHasPermission("captain", "order:merge-tables")).toBe(false);
    expect(roleHasPermission("captain", "order:split-order")).toBe(false);
    expect(roleHasPermission("captain", "order:transfer-table")).toBe(false);
  });
});
