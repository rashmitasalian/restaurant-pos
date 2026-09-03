# Captain app — work overview

Status as of modernization pass (Sep 2026). Captain is the phone-only waiter handheld served by the POS Local Gateway over LAN. This document summarizes what exists today, what changed in the modernization, and how to try it.

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
4. **Send KOT** is the saffron accent action (disabled when nothing new)

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

- Branded card: hotel/product mark, username, password (show/hide), pairing code
- If a pairing code is already stored → collapsed **Paired with POS** + Change
- Hint that Local Gateway on this Wi‑Fi is required
- Errors shown on the login card

### Floor

- Header: **Floor**, occupancy pill (`n/total`), connection status dot only
- Sticky area chips; 2-column floor tiles
- Available: **Tap to start** (not a dead “Ready” label)
- Occupied: amount + items · age; age tone can escalate (saffron / danger)
- Attention (`ready` / `held`): Pending
- Skeletons while loading; empty state per area
- Tap → `openTable` → **session (menu)**; optional Resume banner if an order is still open

### Service session (menu)

- Compact session header: back, table name, live total
- Sticky search + category chips (Favorites with icon, not emoji)
- Handheld tiles: category letter mark, price, visible **+**, qty badge / steppers
- Variants open `VariantSheet` (Regular + options) before add
- Cart dock (`button`): item count · total · **Review** (+ saffron unsent bubble)
- Empty search: “No items match” + clear

### Order sheet (replaces full-page ticket + separate Send KOT confirm)

- Bottom sheet (~90%): New (not sent) first, Sent quieter below
- 48px qty steppers; reducing below sent qty → void sheet
- Single **Send KOT** (disabled + helper when `newCount === 0`)
- Toast on success; no second confirm sheet

### KOTs tab

- New gateway API: `GET /api/kots`
- List of open table tickets: table, status / unsent, summary, relative time
- Tap row → open that table’s session
- Tab badge when any ticket has unsent lines
- Empty: “No kitchen tickets yet”

### Me

- Profile (avatar initial, name, Captain)
- Connection + **Retry**
- Hotel, truncated device id, pairing status
- Sign out (logout lives here; header **Out** removed)

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
| PWA-ish | `manifest.webmanifest` + apple-touch-icon / meta (no service worker; POS is source of truth) |

### Login still needs three things

1. Captain username  
2. Password  
3. **POS pairing code** (shown on desktop when Local Gateway is running)

After first success, the phone stores the pairing code and shows **Paired with POS** until Change.

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
- Guest count, item notes, swipe gestures
- Native store app / offline service worker
- Billing / settle from Captain
- Changing permissions or KOT print pipeline behavior

---

## How to try it

1. Run desktop POS with Local Gateway on.
2. Ensure renderer includes Captain (`npm run build:renderer` or full start so `dist/captain` exists).
3. On phone (same Wi‑Fi), open the gateway URL from the POS panel.
4. Sign in with a captain user + pairing code (or demo seed accounts above).
5. Smoke path: Floor → open table → add items → Review → Send KOT → KOTs tab → Me.

Optional: Add to Home Screen to hide browser chrome (manifest present; no offline cache).
