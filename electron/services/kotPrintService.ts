import { buildKotLines, buildKotVoidLines } from "../../src/shared/kotTicket";
import { getUnsentKotLines, pendingKotQty } from "../../src/shared/kot";
import {
  DEFAULT_USB_PRINTER_NAME,
  resolveCounterPrinterTarget,
  resolveKitchenPrinterTarget,
} from "../../src/shared/printerConfig";
import { printPayload, type PrinterConfig } from "../printing/printService";
import { posService } from "./posService";

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
    options: { clientOpId?: string | null } = {},
  ) {
    const clientOpId = String(options.clientOpId || "").trim();
    if (clientOpId) {
      const existing = posService.getClientOp(clientOpId);
      if (existing) {
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
    const unsent = getUnsentKotLines(order.items || []);
    if (!unsent.length) {
      throw new Error("kot-no-unsent-items");
    }

    const kotSeq = posService.getNextKotSeq();
    const branding = getBranding();
    const preview = {
      kotId: kotSeq,
      sentBy: displayNameFor(actorUsername),
      orderType: order.orderType || (order.tableId ? "table" : "takeaway"),
      tableNum: order.tableId,
      items: unsent.map((line) => ({
        id: line.id,
        name: line.name,
        qty: pendingKotQty(line),
        sentQty: Number(line.qty || 0),
      })),
      platform: (order.meta as any)?.platform,
      platformCode: (order.meta as any)?.code,
      customerName: (order.meta as any)?.customerName,
      customerPhone: (order.meta as any)?.customerPhone,
    };
    const lines = buildKotLines(preview, order, order.tableId, branding);
    const sentLines = preview.items.map((item) => ({
      id: String(item.id),
      sentQty: Number(item.sentQty || item.qty || 0),
    }));

    try {
      await printKitchenLines(lines);
    } catch (error: any) {
      posService.markKotFailed(orderId, error?.message || String(error), actorUsername);
      throw error;
    }

    const updated = posService.markKotSent(orderId, sentLines, actorUsername);
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
        result,
      });
    }
    return { replay: false as const, ...result };
  },

  async voidKotLineAndPrint(
    orderId: string,
    input: { lineId: string; finalQty: number; reason: string },
    actorUsername: string,
    options: { clientOpId?: string | null } = {},
  ) {
    const clientOpId = String(options.clientOpId || "").trim();
    if (clientOpId) {
      const existing = posService.getClientOp(clientOpId);
      if (existing) {
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

    const branding = getBranding();
    const lines = buildKotVoidLines(
      {
        orderType: order.orderType || (order.tableId ? "table" : "takeaway"),
        tableNum: order.tableId,
        reason: input.reason,
        items: [{ name: line.name, qty: voidQty }],
        sentBy: displayNameFor(actorUsername),
      },
      branding,
    );

    await printKitchenLines(lines);
    const updated = posService.voidKotLine(orderId, input, actorUsername);
    const result = { ok: true as const, order: updated, voidQty };
    if (clientOpId) {
      posService.rememberClientOp({
        id: clientOpId,
        username: actorUsername,
        action: "order.void-item",
        entityId: orderId,
        result,
      });
    }
    return { replay: false as const, ...result };
  },
};
