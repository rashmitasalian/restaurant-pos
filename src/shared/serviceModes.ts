export const SERVICE_MODE_CONFIG_KEY = "config:service-modes";

export type ServiceModeId = string;
export type LegacyOrderType = "table" | "takeaway" | "delivery";

export type ServiceMode = {
  id: ServiceModeId;
  name: string;
  enabled: boolean;
  requiresTable: boolean;
  requiresCustomer: boolean;
  supportsOpenOrders: boolean;
  supportsKOT: boolean;
  immediateBilling: boolean;
  externalPayment: boolean;
  allowMergeOrders: boolean;
  color: string;
  icon: string;
  displayOrder: number;
  paymentPrintSequence: "bill_only" | "bill_then_kot" | "kot_then_bill";
};

const DEFAULT_SERVICE_MODE_SEED: ReadonlyArray<ServiceMode> = [
  {
    id: "table",
    name: "Dine In",
    enabled: true,
    requiresTable: true,
    requiresCustomer: false,
    supportsOpenOrders: true,
    supportsKOT: true,
    immediateBilling: false,
    externalPayment: false,
    allowMergeOrders: true,
    color: "#2563eb",
    icon: "utensils",
    displayOrder: 1,
    paymentPrintSequence: "bill_only",
  },
  {
    id: "self_service",
    name: "Self Service",
    enabled: false,
    requiresTable: false,
    requiresCustomer: false,
    supportsOpenOrders: false,
    supportsKOT: true,
    immediateBilling: true,
    externalPayment: false,
    allowMergeOrders: false,
    color: "#16a34a",
    icon: "person",
    displayOrder: 2,
    paymentPrintSequence: "bill_then_kot",
  },
  {
    id: "takeaway",
    name: "Takeaway",
    enabled: true,
    requiresTable: false,
    requiresCustomer: false,
    supportsOpenOrders: true,
    supportsKOT: true,
    immediateBilling: false,
    externalPayment: false,
    allowMergeOrders: false,
    color: "#f59e0b",
    icon: "bag",
    displayOrder: 3,
    paymentPrintSequence: "bill_only",
  },
  {
    id: "delivery",
    name: "Delivery",
    enabled: true,
    requiresTable: false,
    requiresCustomer: false,
    supportsOpenOrders: true,
    supportsKOT: true,
    immediateBilling: false,
    externalPayment: true,
    allowMergeOrders: false,
    color: "#0ea5e9",
    icon: "bike",
    displayOrder: 4,
    paymentPrintSequence: "bill_only",
  },
];

const BUILTIN_DISPLAY_ORDER: Record<string, number> = {
  table: 1,
  self_service: 2,
  takeaway: 3,
  delivery: 4,
};

function normalizeId(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeName(value: unknown, fallback: string) {
  const name = String(value || "").trim();
  return name || fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "1" || value === 1 || value === "true") {
    return true;
  }
  if (value === "0" || value === 0 || value === "false") {
    return false;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(parsed));
}

function normalizeColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function normalizeIcon(value: unknown, fallback: string) {
  const icon = String(value || "")
    .trim()
    .toLowerCase();
  return icon || fallback;
}

function normalizePaymentPrintSequence(
  value: unknown,
  fallback: ServiceMode["paymentPrintSequence"],
): ServiceMode["paymentPrintSequence"] {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "bill_only" || key === "bill_then_kot" || key === "kot_then_bill") {
    return key;
  }
  return fallback;
}

function normalizeMode(raw: unknown, fallback?: ServiceMode): ServiceMode | null {
  const source = (raw || {}) as Partial<ServiceMode>;
  const id = normalizeId(source.id || fallback?.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: normalizeName(source.name, fallback?.name || id),
    enabled: normalizeBoolean(source.enabled, fallback?.enabled ?? true),
    requiresTable: normalizeBoolean(source.requiresTable, fallback?.requiresTable ?? false),
    requiresCustomer: normalizeBoolean(
      source.requiresCustomer,
      fallback?.requiresCustomer ?? false,
    ),
    supportsOpenOrders: normalizeBoolean(
      source.supportsOpenOrders,
      fallback?.supportsOpenOrders ?? true,
    ),
    supportsKOT: normalizeBoolean(source.supportsKOT, fallback?.supportsKOT ?? true),
    immediateBilling: normalizeBoolean(
      source.immediateBilling,
      fallback?.immediateBilling ?? false,
    ),
    externalPayment: normalizeBoolean(source.externalPayment, fallback?.externalPayment ?? false),
    allowMergeOrders: normalizeBoolean(
      source.allowMergeOrders,
      fallback?.allowMergeOrders ?? false,
    ),
    color: normalizeColor(source.color, fallback?.color || "#6b7280"),
    icon: normalizeIcon(source.icon, fallback?.icon || "circle"),
    displayOrder:
      BUILTIN_DISPLAY_ORDER[id] ||
      normalizeInteger(source.displayOrder, fallback?.displayOrder ?? 100),
    paymentPrintSequence: normalizePaymentPrintSequence(
      source.paymentPrintSequence,
      fallback?.paymentPrintSequence || "bill_only",
    ),
  };
}

export function getDefaultServiceModes(): ServiceMode[] {
  return DEFAULT_SERVICE_MODE_SEED.map((mode) => ({ ...mode }));
}

export function normalizeServiceModes(input: unknown): ServiceMode[] {
  const defaults = getDefaultServiceModes();
  const byId = new Map<string, ServiceMode>();
  defaults.forEach((mode) => byId.set(mode.id, mode));

  const rawList = Array.isArray((input as any)?.modes)
    ? ((input as any).modes as unknown[])
    : Array.isArray(input)
      ? (input as unknown[])
      : [];

  for (const raw of rawList) {
    const mode = normalizeMode(raw, byId.get(normalizeId((raw as any)?.id)));
    if (!mode) {
      continue;
    }
    byId.set(mode.id, mode);
  }

  return Array.from(byId.values()).sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
}

export function toServiceModeConfigDoc(input: unknown) {
  return {
    modes: normalizeServiceModes(input),
  };
}

export function getEnabledServiceModes(input: unknown): ServiceMode[] {
  return normalizeServiceModes(input).filter((mode) => mode.enabled);
}

export function findServiceModeById(input: unknown, id: string): ServiceMode | null {
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    return null;
  }
  return normalizeServiceModes(input).find((mode) => mode.id === normalizedId) || null;
}

export function toLegacyOrderType(mode: ServiceMode | null | undefined): LegacyOrderType {
  if (!mode) {
    return "takeaway";
  }
  if (mode.requiresTable) {
    return "table";
  }
  if (mode.externalPayment) {
    return "delivery";
  }
  return "takeaway";
}
