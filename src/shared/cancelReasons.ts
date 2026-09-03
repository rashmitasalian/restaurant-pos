/** Preset reasons for voiding sent KOT items / cancelling open lines. */
export const CANCEL_REASON_PRESETS = [
  "Customer changed order",
  "Item unavailable",
  "Wrong item",
  "Wrong table",
  "Duplicate",
  "Other",
] as const;

export type CancelReasonPreset = (typeof CANCEL_REASON_PRESETS)[number];

export const CANCEL_REASON_OTHER: CancelReasonPreset = "Other";

export function isPresetCancelReason(value: string): value is CancelReasonPreset {
  return (CANCEL_REASON_PRESETS as readonly string[]).includes(value);
}

/** Normalize a selected preset + optional free-text into the stored reason string. */
export function resolveCancelReason(preset: string, otherText?: string | null): string {
  const selected = String(preset || "").trim();
  if (!selected) {
    return "";
  }
  if (selected === CANCEL_REASON_OTHER) {
    return String(otherText || "").trim();
  }
  return selected;
}
