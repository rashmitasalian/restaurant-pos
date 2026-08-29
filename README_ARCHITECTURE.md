# Restaurant POS - Current Architecture

This document describes the code that is currently implemented in this repo.

## 1. Product Scope

- Single restaurant, single local POS desktop app.
- Offline-first operation with a local SQLite database.
- Role-based login for `admin` and `cashier`.
- Dine-in table orders, takeaway orders, delivery orders, KOT flow, payments, reports, audit logs, customers, staff, settings, and local backup/restore.
- Thermal printing through ESC/POS bytes sent from Electron main.

Out of scope for the current app:

- Multi-branch operation.
- Online ordering API integration.
- Inventory and stock management.
- GST filing or e-invoice submission.
- Waiter phone app and remote owner dashboard. These remain Phase 2+ work.

## 2. Runtime Shape

```text
React renderer
  |
  | window.pos preload API
  v
Electron IPC handlers
  |
  v
posService domain layer
  |
  v
SQLite database in Electron userData
```

The renderer is sandboxed with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. It does not open SQLite, read files, or call printer APIs directly. The preload exposes a narrow `window.pos` API backed by `ipcRenderer.invoke`.

Electron main owns:

- SQLite initialization and migrations.
- Auth/session validation.
- Backup and restore dialogs.
- PDF export.
- Renderer log persistence.
- ESC/POS printing.

## 3. Key Files

- `electron/main.ts`: app window, security settings, CSP, printing, PDF export, renderer log sink.
- `electron/env.ts`: main-process `.env` loader.
- `electron/db/sqlite.ts`: SQLite path, schema, migrations, seed data, backup/restore.
- `electron/ipc/posIpc.ts`: IPC contract and role checks.
- `electron/services/posService.ts`: business logic for users, orders, KOT, payments, reports, settings, staff, customers, print queue, backups, and audit.
- `electron/services/sessionManager.ts`: in-memory session tokens bound to the renderer webContents id.
- `electron/services/credentials.ts`: scrypt credential hashing.
- `electron/preload.ts` and `electron/preload.js`: secure renderer API.
- `src/app/db/posRepository.ts`: renderer facade over explicit `window.pos` SQLite/IPC APIs.
- `src/shared/pos.ts`: shared DTOs.
- `src/shared/gst.ts`: GST normalization and totals.
- `src/ui/App.tsx`: auth gate and role-filtered navigation.

UI work uses the RestoNiti 2026 design system (`docs/design-system.md`, `src/ui/theme/`, `src/ui/components/ui/`). See `docs/ONBOARDING.md` for a repo map and migration notes.

## 4. Database

The source of truth is one SQLite database:

```text
<Electron userData>/data/restaurant-pos.sqlite
```

Schema areas:

- `users`, `admin_recovery_codes`
- `tables`
- `menu_categories`, `menu_items`
- `customers`
- `staff`
- `orders`, `order_lines`, `payments`
- `settings`
- `audit_logs`, `audit_archives`
- `print_jobs`
- `backup_records`

SQLite runs with foreign keys enabled, WAL journaling, and a busy timeout. `better-sqlite3` is required in development and production; there is no secondary SQL runtime.

## 5. Auth And Roles

Passwords are hashed in the main process with scrypt. Unsupported or missing hash algorithms fail closed.

Sessions are random main-process tokens stored in memory and bound to a webContents id. The renderer stores the token in localStorage so preload can attach it to IPC calls, but every protected IPC call revalidates the main-process session and current user state.

Role enforcement happens in two places:

- UI navigation filters pages by role.
- IPC handlers enforce role requirements before calling `posService`.

Admin-only areas include reports, history, settings, audit, staff, and users. Cashiers can operate tables, billing, KOT, and customers.

## 6. Orders And KOT

Orders support `table`, `takeaway`, and `delivery` types.

KOT state is stored on the order as `kot_status`:

- `pending`: items exist that have not been sent to kitchen.
- `sent`: all current item quantities have been printed/sent.
- `printed`: kitchen marks the KOT done.
- `failed`: print attempt failed and can be retried.

Line-level `kot_printed_qty` records how much of each line has been sent. When quantities increase after a KOT, only the delta becomes pending.

Print failures are persisted in `print_jobs`. KOT print jobs include order id and line quantities, so a successful queued retry can update `kot_printed_qty` and `kot_status`.

## 7. Payments And GST

Payments are stored separately from orders. Paying an order:

- Recalculates totals from current lines and current GST config.
- Creates a payment row.
- Issues the next invoice number from `config:invoice`.
- Stores a GST snapshot on order metadata.
- Marks the order `paid`.

GST is controlled by `config:gst.enabled`. A configured rate does not apply unless GST is enabled.

## 8. Printing

The main process builds raw ESC/POS buffers.

Print payloads must contain structured ESC/POS line directives. Plain-text print bodies are rejected instead of being reformatted implicitly.

Supported targets:

- IPv4 address: writes bytes to the configured printer TCP port, default `9100`.
- Windows printer name: writes a temp binary file and sends it through a PowerShell/C# Winspool helper using `OpenPrinter`, `StartDocPrinter`, and `WritePrinter` with datatype `RAW`.

USB printers should be installed in Windows and configured by printer name. The app does not require `escpos`, `escpos-usb`, `usb`, `ffi-napi`, or printer-specific native npm packages for the normal print path.

## 9. Settings And Environment

Renderer-facing settings use Vite `VITE_*` variables and persisted SQLite settings. Main-process runtime values are loaded from `.env` by `electron/env.ts` before services read `process.env`.

Important persisted settings:

- `config:printers`
- `config:tables`
- `config:categories`
- `config:gst`
- `config:branding`
- `config:audit`
- `config:history`
- `config:invoice`

## 10. Backup And Restore

Admin users can create local SQLite backups from Settings. Restore validates the SQLite header and integrity when possible, creates a pre-restore safety backup, replaces the active DB, and reinitializes the database.

## 11. Phase 2 Direction

The current app is SQLite-first, not PouchDB-first. Any waiter app or remote owner dashboard must be designed around a deliberate sync/API layer.

Recommended Phase 2 path:

- Add a local main-process HTTP API or sync service on the POS machine.
- Keep SQLite as the local authority for POS writes.
- Introduce explicit conflict handling for multi-device order edits.
- Keep credentials in the main process or OS-protected app data, not in renderer storage.
- Add a startup KOT recovery scan based on SQLite `kot_status` and `kot_printed_qty`.
