# Captain app — work overview

Status as of October 2026. Captain is the phone-only waiter handheld served by the POS Local Gateway over LAN. This document is the current behavior. `docs/captain-experience-plan.pdf` is the earlier planning snapshot; where they differ, this file wins.

---

## What Captain is

Captain is a separate Vite entry (`src/captain/`) built to `dist/captain/` and served when the desktop POS Local Gateway is running. Staff sign in on a phone/browser on the same Wi‑Fi; they open tables, add items, send KOTs, and void sent qty. They do **not** settle bills or use Manage screens.

| Capability | Permission |
| --- | --- |
| Open / resume table | `order:open` |
| Add items | `order:add-item` |
| Send KOT | `order:send-kot` |
| Void / reduce sent qty | `order:void-item` |

Captain accounts are blocked from desktop POS login (`captain-phone-only`).

---

## Before vs after

### Before (functional but form-like)

1. Tap table → empty ticket (“No items yet”)
2. Tap **Add items** → leave the order
3. Tap a text-only menu card (no clear + control)
4. Return to ticket → **Send KOT** (same weight as Add items)

Bottom nav was only **Tables** + **More**. Tapping Tables cleared the open order. Chrome repeated name/role on every screen. Qty steppers were undersized; loading/empty states were thin.

### After (menu-first waiter app)

1. Tap table → **menu workspace** immediately
2. Tap **+** on tiles (qty badge / − + when already on the ticket)
3. **Review** dock opens an order bottom sheet
4. **Send to kitchen** is the primary action (disabled when nothing new)

Bottom nav is **Floor / KOTs / Me**. Switching tabs keeps the active table + order; Floor can show **Resume**. Login, Floor, session, KOTs, and Me were redesigned inside the existing teal design tokens (no new UI framework).

```
Floor → tap table → Menu workspace
                      ↓ Review dock
                 Order sheet → Send KOT
Floor / KOTs / Me ← bottom tabs (order kept)
```

---

## Screens and flows delivered

### Login

- Restaurant name, last username, password (show/hide)
- **Connected** and **Paired** are separate. Connected means the phone can reach the POS. Paired means a pairing code is saved. After a POS restart the phone can stay Paired while the connection is Reconnecting. A rejected or rotated code shows **Needs pairing**
- Pairing field stays hidden once a code is stored or a QR link (`/?pair=CODE`) fills it. **Change** shows the field again
- Copy shows the gateway address. Errors on the card use distinct copy (wrong password, locked, inactive, pairing invalid, POS unavailable)

### Floor

- Greeting, area picker, occupancy, table search
- Status filters, same words as the desktop Tables screen, plus the captain work list: **All** (default, every table) · **Available** (empty) · **Open** (has a check) · **Needs send** (unsent food still on the table)
- Search finds a table in the current area even when a status filter is on
- Status legend: **Available** · **Send KOT** · **KOT sent**. Colors match the POS: grey free, saffron **Send KOT**, teal **KOT sent**. Age is text on the card. It does not repaint the card red
- Shared `TableTile` + `tableKotAppearance`. Meta: `n to send` / `Not sent` when attention; items · age when KOT sent
- Empty open orders stay Available (occupied only when item count > 0)
- Available tap → menu without opening an order; first add creates the order. Occupied tap loads the existing order. **Resume** returns to the table left open
- Phone Back from the menu returns to the floor and keeps the order. It does not close the app or sign out

### Menu

- Compact header: back, table name, count, live total
- Search matches item name or code (SKU). Rows show the code when the item has one
- Diet mark is the Indian square outline with a dot, to the left of the dish name (green veg, red non-veg, saffron egg)
- Category chips: Favorites, All, a few named categories, then **More** for the rest
- **+** adds a simple item. Variants open `VariantSheet`. The stepper changes quantity only when that dish has exactly one line on the order
- Review dock: item count · total · **Review**

### Order sheet

- Bottom sheet: unsent lines first, **KOT sent** below
- A kitchen note (up to 80 characters) sits on an unsent line, prints under that line on the next KOT, and shows on the desktop order row. A fully sent line keeps its note until more quantity is added
- **Send to kitchen** is the primary action. **Preview** opens the ticket first; the preview button also sends. The phone does not say Print KOT
- Reducing below sent quantity opens the void sheet (reason, then void KOT)
- Toast on success

### KOTs tab

- `GET /api/kots`, same membership as the desktop KOT Queue (`isKotQueueTicket`): tickets the kitchen already has
- One list. No Today or Send KOT filter. Unsent-only tables stay on the floor under **Needs send**
- Each row: table name, `n to send` or **KOT sent**, item summary, age
- Tap a row to open that table
- Tab badge when any ticket still has unsent lines
- Empty: “No kitchen tickets”

### Me

- Profile (avatar initial, name, Captain)
- Connection and **Retry**, separate from pairing (**Paired** / **Needs pairing** / **Not saved**)
- Hotel, truncated device id
- Sign out asks for a second confirm

---

## Architecture notes

| Piece | Location / behavior |
| --- | --- |
| Entry | `src/captain/index.html` → `main.tsx` → `CaptainApp` |
| Shell | `CaptainShell.tsx` — chrome, body, Floor/KOTs/Me nav |
| State screens | `login \| floor \| session \| kots \| me` in `CaptainApp.tsx` |
| API client | `captainApi.ts` — HTTP + SSE; session in `localStorage` |
| Gateway | `electron/gateway/localGateway.ts` — auth, tables, menu, orders, **kots**, events, static Captain UI |
| Domain list | `posService.getCaptainKots()` aggregates open dine-in orders / line KOT qty |
| Visual system | POS `--pos-*` tokens + `captain.css` (`cap-*`); Lucide via `Icon` |
| Install / home screen | Manifest name **RestoNiti** + 192/512/maskable icons at `/captain/icons/` (iOS Add to Home Screen). **No service worker, no HTTPS, no `vite-plugin-pwa`.** LAN HTTP is not a secure context, so Android install prompts are not available. Header uses the same RestoNiti mark/wordmark as desktop POS. |

### Connection and sessions

- HTTP requests time out (20s; health/branding/logout 8s). SSE reconnects with backoff up to 30s.
- Returning to the phone (`visibilitychange` / focus) refreshes tables, KOTs, and the open order from the gateway.
- LAN sessions stay **in memory** on the POS. A POS/gateway restart invalidates tokens; Captain shows login again (401). That is intentional (Model A), not a reconnect bug.

### Idempotency (`client_ops`)

Captain sends a **new** `clientOpId` per gesture (`open-table`, `add-item`, `update-lines`, `send-kot`, `void-item`). Retrying the **same** id replays the stored result. Reusing an id with a **different** body is rejected (`client-op-conflict` / 409).

Two `+` taps are two gestures (two ids). POS still merges the same line so qty becomes 2. Idempotency does **not** collapse two taps into one add.

Printers still cannot guarantee a single physical print. A successful send-kot remembered in `client_ops` will not print again on retry; a failed print is not remembered, so retry may print.

### HTTPS vs Capacitor (deferred)

Do **not** add gateway TLS or Capacitor in this wave. After restaurant testing, decide:

- HTTPS on the gateway (cert trust on every phone) if we need a real Android PWA + service worker, **or**
- Keep HTTP + iOS A2HS, then wrap the same `src/captain` build in Capacitor later.

Until that product decision, Captain remains LAN HTTP only.

### Login still needs three things

1. Captain username
2. Password
3. **POS pairing code**

On the desktop, the header **Gateway** chip opens **Captain phones**: a QR of `http://<lan-ip>:4747/?pair=CODE`, the code, the full URL, Copy URL, and phones currently connected. Scanning the QR stores the code and hides the pairing field. Rotating the code (requires `system:settings`) makes new phones pair again. Captains already signed in stay signed in until the POS restarts.

### Demo / test accounts (opt-in seed)

From `scripts/demo-seed.cjs` (password for all):

| Username | Display |
| --- | --- |
| `priya` | Captain Priya |
| `rahul` | Captain Rahul |
| `amit` | Captain Amit |

Password: `Captain1!`

---

## Files touched in the modernization

**Captain UI**

- `src/captain/CaptainApp.tsx`, `CaptainShell.tsx`, `captain.css`, `captainApi.ts`, `main.tsx`, `index.html`
- `src/captain/screens/` — Login, Tables (Floor), Menu, **Kots**, **Me**
- `src/captain/sheets/` — Variant, **Order**, **Void** (removed full-page Ticket + SendKotSheet)
- `src/captain/manifest.webmanifest`, `money.ts`

**Shared / backend**

- `src/ui/components/ui/TableTile.tsx` — optional `idleLabel` (Captain: “Tap to start”; desktop default unchanged)
- `electron/services/posService.ts` — `getCaptainKots()`
- `electron/gateway/localGateway.ts` — `GET /api/kots`, webmanifest content-type

**Removed**

- `src/captain/screens/TicketScreen.tsx`
- `src/captain/sheets/SendKotSheet.tsx`

---

## Explicitly out of scope (still)

- Desktop Billing / Tables layout redesign
- Food photos / menu image pipeline
- Guest count, food photos, swipe gestures
- Native store app / offline service worker / HTTPS on the gateway
- Billing / settle from Captain
- Changing permissions or KOT print pipeline behavior
- Durable LAN sessions across POS restart
- Offline mutation queue / `orderVersion` concurrency

---

## How to try it

1. Run desktop POS with Local Gateway on.
2. Ensure renderer includes Captain (`npm run build:renderer` or full start so `dist/captain` exists).
3. On phone (same Wi‑Fi), open the gateway URL from the POS panel.
4. Sign in with a captain user + pairing code (or demo seed accounts above).
5. Smoke path: Floor → open table → add items → Review → Send to kitchen → KOTs tab → Me.

Optional: Add to Home Screen to hide browser chrome (manifest + icons; no offline cache, no Android install prompt on LAN HTTP).
