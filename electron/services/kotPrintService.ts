import { buildKitchenUpdateLines } from "../../src/shared/kotTicket";
import { getUnsentKotLines, netKitchenDelta, pendingKotVoidsFromMeta } from "../../src/shared/kot";
import { formatTableTileLabel } from "../../src/shared/floorLayout";
import {
  DEFAULT_USB_PRINTER_NAME,
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
} from "../../src/shared/printerConfig";
import { printPayload, type PrinterConfig } from "../printing/printService";
import { posService } from "./posService";

function tableLabelForOrder(order: { tableId?: number | null }) {
  const tableId = order.tableId != null ? Number(order.tableId) : null;
  if (tableId === null || !Number.isFinite(tableId) || tableId <= 0) {
    return "";
  }
  const table = posService.getTables().find((entry) => Number(entry.id) === tableId);
  return formatTableTileLabel(tableId, table?.name);
}

function getPrinterConfig(): PrinterConfig {
  try {
    const cfg = (posService.getSetting("config:printers") as any) || {};
    const kitchenFallback =
      process.env.KITCHEN_PRINTER_USB_NAME ||
      process.env.COUNTER_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    const counterFallback =
      process.env.COUNTER_PRINTER_USB_NAME ||
      process.env.KITCHEN_PRINTER_USB_NAME ||
      DEFAULT_USB_PRINTER_NAME;
    return {
      kitchenPrinterName: resolveKitchenPrinterTarget(cfg, kitchenFallback),
      counterPrinterName: resolveCounterPrinterTarget(cfg, counterFallback),
      printerPort: Number(cfg.printerPort || process.env.PRINTER_PORT || 9100),
    };
  } catch {
    return {
      kitchenPrinterName: process.env.KITCHEN_PRINTER_USB_NAME || DEFAULT_USB_PRINTER_NAME,
      counterPrinterName:
        process.env.COUNTER_PRINTER_USB_NAME ||
        process.env.KITCHEN_PRINTER_USB_NAME ||
        DEFAULT_USB_PRINTER_NAME,
      printerPort: Number(process.env.PRINTER_PORT || 9100),
    };
  }
}

function getBranding() {
  const cfg = (posService.getConfigDoc("config:branding") || {}) as any;
  return {
    hotelName: String(cfg.hotelName || process.env.HOTEL_NAME || "Restaurant").trim(),
  };
}

function displayNameFor(username?: string | null) {
  if (!username) {
    return "Staff";
  }
  const user = posService.getUserByUsername(username);
  return user?.displayName || username;
}

async function printKitchenLines(lines: string[]) {
  const cfg = getPrinterConfig();
  const branding = getBranding();
  return printPayload(
    {
      type: "kot",
      printer: "kitchen",
      data: { lines },
    },
    cfg,
    { hotelName: branding.hotelName },
  );
}

export const kotPrintService = {
  async sendKotForOrder(
    orderId: string,
    actorUsername: string,
    options: { clientOpId?: string | null; baseUpdatedAt?: number | null } = {},
  ) {
    const clientOpId = String(options.clientOpId || "").trim();
    if (clientOpId) {
      const existing = posService.getClientOp(clientOpId);
      if (existing) {
        posService.assertClientOpRequest(existing, { orderId });
        return {
          replay: true as const,
          result: existing.result,
          order: posService.getOrderById(orderId),
        };
      }
    }

    const order = posService.getOrderById(orderId);
    if (!order) {
      throw new Error("order-not-found");
    }
    if (options.baseUpdatedAt != null && Number.isFinite(Number(options.baseUpdatedAt))) {
      if (Number(order.updatedAt) !== Number(options.baseUpdatedAt)) {
        throw new Error("order-conflict");
      }
    }
    const pendingVoids = pendingKotVoidsFromMeta(order.meta);
    const unsent = getUnsentKotLines(order.items || []);
    if (!unsent.length && !pendingVoids.length) {
      throw new Error("kot-no-unsent-items");
    }
    const delta = netKitchenDelta(pendingVoids, order.items || []);
    if (!delta.stop.length && !delta.make.length) {
      const updated = posService.markKotSent(orderId, delta.sentLines, actorUsername, {
        clearPendingKotVoidIds: delta.clearVoidIds,
      });
      return {
        replay: false as const,
        ok: true as const,
        order: updated,
        kotSeq: null,
        sentLines: delta.sentLines,
      };
    }

    const kotSeq = posService.getNextKotSeq();
    const branding = getBranding();
    const meta = (order.meta || {}) as Record<string, unknown>;
    const preview = {
      kotId: kotSeq,
      sentBy: displayNameFor(actorUsername),
      orderType: order.orderType || (order.tableId ? "table" : "takeaway"),
      tableNum: order.tableId,
      tableLabel: tableLabelForOrder(order),
      items: delta.make,
      voidItems: delta.stop,
      platform: String(meta.platform || meta.orderSource || meta.source || ""),
      platformCode: String(meta.code || meta.orderCode || meta.reference || ""),
      customerName: String(meta.parcelName || meta.customerName || ""),
      customerPhone: String(meta.customerPhone || ""),
    };
    const lines = buildKitchenUpdateLines(preview, order, order.tableId, branding);
    const sentLines = delta.sentLines;

    try {
      await printKitchenLines(lines);
    } catch (error: any) {
      posService.markKotFailed(orderId, error?.message || String(error), actorUsername);
      throw error;
    }

    const updated = posService.markKotSent(orderId, sentLines, actorUsername, {
      clearPendingKotVoidIds: delta.clearVoidIds,
    });
    const result = {
      ok: true as const,
      order: updated,
      kotSeq,
      sentLines,
    };
    if (clientOpId) {
      posService.rememberClientOp({
        id: clientOpId,
        username: actorUsername,
        action: "order.send-kot",
        entityId: orderId,
        request: { orderId },
        result,
      });
    }
    return { replay: false as const, ...result };
  },

  async voidKotLineAndPrint(
    orderId: string,
    input: { lineId: string; finalQty: number; reason: string },
    actorUsername: string,
    options: { clientOpId?: string | null; baseUpdatedAt?: number | null } = {},
  ) {
    const clientOpId = String(options.clientOpId || "").trim();
    if (clientOpId) {
      const existing = posService.getClientOp(clientOpId);
      if (existing) {
        posService.assertClientOpRequest(existing, {
          orderId,
          lineId: input.lineId,
          finalQty: input.finalQty,
          reason: input.reason,
        });
        return {
          replay: true as const,
          result: existing.result,
          order: posService.getOrderById(orderId),
        };
      }
    }

    const order = posService.getOrderById(orderId);
    if (!order) {
      throw new Error("order-not-found");
    }
    if (options.baseUpdatedAt != null && Number.isFinite(Number(options.baseUpdatedAt))) {
      if (Number(order.updatedAt) !== Number(options.baseUpdatedAt)) {
        throw new Error("order-conflict");
      }
    }
    const line = order.items.find((candidate) => candidate.id === input.lineId);
    if (!line) {
      throw new Error("order-line-not-found");
    }
    const sentQty = Math.max(0, Number(line.kotPrintedQty || 0));
    const finalQty = Math.max(0, Number(input.finalQty) || 0);
    const voidQty = sentQty - finalQty;
    if (voidQty <= 0) {
      throw new Error("kot-void-not-required");
    }

    const updated = posService.voidKotLine(orderId, input, actorUsername, {
      baseUpdatedAt: options.baseUpdatedAt,
    });
    const result = { ok: true as const, order: updated, voidQty };
    if (clientOpId) {
      posService.rememberClientOp({
        id: clientOpId,
        username: actorUsername,
        action: "order.void-item",
        entityId: orderId,
        request: {
          orderId,
          lineId: input.lineId,
          finalQty: input.finalQty,
          reason: input.reason,
        },
        result,
      });
    }
    return { replay: false as const, ...result };
  },
};
