import { EventEmitter } from "events";
import type { BrowserWindow } from "electron";

export type DomainEventType =
  | "orders-changed"
  | "activity-changed"
  | "tables-changed"
  | "gateway-status"
  | "lan-sessions-revoked";

export type DomainEvent = {
  type: DomainEventType;
  at: number;
  payload?: Record<string, unknown>;
};

type DomainEventListener = (event: DomainEvent) => void;

const bus = new EventEmitter();
bus.setMaxListeners(50);

let getMainWindow: (() => BrowserWindow | null) | null = null;

export function configureDomainEvents(getter: () => BrowserWindow | null) {
  getMainWindow = getter;
}

export function publishDomainEvent(
  type: DomainEventType,
  payload?: Record<string, unknown>,
): DomainEvent {
  const event: DomainEvent = {
    type,
    at: Date.now(),
    payload: payload || undefined,
  };
  bus.emit("domain", event);
  bus.emit(type, event);

  const win = getMainWindow?.() ?? null;
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send("pos:domain-event", event);
    } catch {
      // ignore destroyed window races
    }
  }
  return event;
}

/** One wake per mutation. Desktop maps this to floor + activity; Captain SSE must not get a 3× stampede. */
export function publishOrdersChanged(payload?: Record<string, unknown>) {
  publishDomainEvent("orders-changed", payload);
}

export function onDomainEvent(listener: DomainEventListener) {
  bus.on("domain", listener);
  return () => bus.off("domain", listener);
}

export function onDomainEventType(type: DomainEventType, listener: DomainEventListener) {
  bus.on(type, listener);
  return () => bus.off(type, listener);
}
