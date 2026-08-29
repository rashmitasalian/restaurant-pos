/**
 * Central environment configuration for the renderer process.
 *
 * All values come from .env (VITE_* prefix, injected by Vite at build time).
 * Defaults are the current app defaults; copy .env.example to .env to customise.
 *
 * Usage:  import { ENV } from "../config/env";
 */
export const ENV = {
  // ── Business identity ───────────────────────────────────────────────────────
  /** Hotel / restaurant name — appears on login, header, receipts and KOTs. */
  HOTEL_NAME: import.meta.env.VITE_HOTEL_NAME ?? "",
  /** 2-letter initials shown in the logo badge. */
  HOTEL_INITIALS: import.meta.env.VITE_HOTEL_INITIALS ?? "",
  /** Contact phone number printed on receipts (leave blank to omit). */
  HOTEL_PHONE: import.meta.env.VITE_HOTEL_PHONE ?? "",
  /** Contact email printed on receipts (leave blank to omit). */
  HOTEL_EMAIL: import.meta.env.VITE_HOTEL_EMAIL ?? "",
  /** Application display name. */
  APP_NAME: import.meta.env.VITE_APP_NAME ?? "RestoNiti",

  // ── Tax & currency ──────────────────────────────────────────────────────────
  /** BCP 47 locale used with Intl.NumberFormat, e.g. "en-IN". */
  CURRENCY_LOCALE: import.meta.env.VITE_CURRENCY_LOCALE ?? "en-IN",
  /** ISO 4217 currency code, e.g. "INR". */
  CURRENCY_CODE: import.meta.env.VITE_CURRENCY_CODE ?? "INR",

  // ── Tables ──────────────────────────────────────────────────────────────────
  /** Number of dine-in tables seeded on first run. */
  TABLE_COUNT: Number(import.meta.env.VITE_TABLE_COUNT ?? 12),

  // ── Database ────────────────────────────────────────────────────────────────
  // ── Printer ─────────────────────────────────────────────────────────────────
  /** Default TCP port for network (IP) printers. */
  PRINTER_PORT: Number(import.meta.env.VITE_PRINTER_PORT ?? 9100),

  // ── Auth & session ──────────────────────────────────────────────────────────
  /** localStorage key used to persist the active session. */
  SESSION_KEY: import.meta.env.VITE_SESSION_KEY ?? "pos-session",
  /** Idle auto-logout timeout in ms (default: 30 min). */
  SESSION_INACTIVITY_MS: Number(import.meta.env.VITE_SESSION_INACTIVITY_MS ?? 1_800_000),
  /** Max consecutive failed login attempts before account is temporarily locked. */
  AUTH_MAX_ATTEMPTS: Number(import.meta.env.VITE_AUTH_MAX_ATTEMPTS ?? 5),
  /** Lockout duration in ms after reaching max failed attempts (default: 15 min). */
  AUTH_LOCKOUT_MS: Number(import.meta.env.VITE_AUTH_LOCKOUT_MS ?? 900_000),
} as const;
