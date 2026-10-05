import { isBackdropPress } from "./useBackdropDismiss";

describe("isBackdropPress", () => {
  const backdrop = { id: "backdrop" };
  const field = { id: "field" };

  it("dismisses only when the press starts and ends on the backdrop", () => {
    expect(isBackdropPress(backdrop, backdrop, backdrop)).toBe(true);
  });

  it("keeps the dialog open when a drag starts in a field and ends on the backdrop", () => {
    expect(isBackdropPress(field, backdrop, backdrop)).toBe(false);
  });

  it("keeps the dialog open when the press starts on the backdrop and ends inside", () => {
    expect(isBackdropPress(backdrop, field, backdrop)).toBe(false);
  });

  it("ignores a release that has no matching press", () => {
    expect(isBackdropPress(null, backdrop, backdrop)).toBe(false);
  });
});
