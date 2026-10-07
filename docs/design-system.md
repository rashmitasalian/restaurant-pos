# RestoNiti 2026 design system

RestoNiti 2026 is a visual and component-system modernization, not a redesign of product behavior: preserve workflows, shortcuts, data, printing, GST and authentication while establishing a restrained teal-first POS design language that is fast to scan, touch-friendly, keyboard-accessible and resistant to visual drift.

## Locked visual rules

- **Deep teal** (`--pos-teal` / `--pos-chrome`) is structure: top bar, Billing rail, primary actions, occupied state.
- **Saffron** (`--pos-saffron`) is a spark: one accent action per view, attention / held only.
- **Light** is the default workspace: `--pos-bg: #F9F8F6`, `--pos-surface: #FFFFFF`. Text ramp: `#17202A` / `#3F4A56` / `#64748B` / `#94A3B8`. Borders: `#E3E5E4` / `#CBD2D0`.
- **Dark** is a low-glare charcoal workspace on the same `--pos-*` names (`html[data-theme="dark"]` in `tokens.css`). It is not pure black, and it does not use pure white text. Teal and saffron stay distinguishable for Available, Send KOT, KOT sent, and Pending.
- **System** follows the operating system. The device preference lives in `localStorage` key `pos-appearance` (`light` | `dark` | `system`), default `light`. Desktop and Captain each store it on their own device. It is not restaurant data and is not stored in SQLite. Print and export HTML stay light.
- Shape language max **10px** (`--pos-r-sm/md/lg/dialog` = 6 / 8 / 10 / 10).
- Billing center IA: **Search → Quick Add (favorites) → Categories → Menu grid**. Quick Add never horizontally scrolls; overflow uses **More**.
- Shared tiles: `MenuTile`, `FavoriteTile`, `TableTile`, `OrderItemRow`.
- **Green** means completed / success. It never means idle or available.
- **Red** means error or destructive only.
- No gradients in product chrome.
- No emoji in product UI. Use the `Icon` primitive (`lucide-react` wrapper).
- One teal primary button per view.
- Motion is feedback: 140ms interaction, 200ms transition, 240ms overlay. Honor `prefers-reduced-motion`.

## Chrome layer

| Token | Role |
| --- | --- |
| `--pos-chrome` | App top bar |
| `--pos-chrome-rail` | Billing context rail (reads recessed) |
| `--pos-chrome-tx` / `--pos-chrome-tx-muted` | Text on chrome |
| `--pos-chrome-hover` / `--pos-chrome-active` | Nav hover / selected surface |
| `--pos-focus-ring-inverse` | Focus on chrome |

Active nav = solid `--pos-chrome-active` plus a saffron edge (selection never depends on color alone).

## Depth levels

| Level | Token | Use |
| --- | --- | --- |
| 1 | `--pos-shadow-1` | Cards, controls |
| 2 | `--pos-shadow-2` | Elevated panels |
| Overlay | `--pos-shadow-overlay` | Modals / dialogs |
| Scrim | `--pos-overlay` | Dim behind overlays |

Shadows are teal-tinted — never pure black `rgba(0,0,0,…)`. Accent sparks may use `--pos-shadow-accent`.

Shape: `--pos-r-sm/md/lg/dialog` = 6 / 8 / 10 / 12. Pills (`--pos-r-badge`) only for status and metadata.

## State semantics

| State | Meaning | Token prefix |
| --- | --- | --- |
| available | Idle / free — label **Available** | `--pos-state-available-*` (neutral) |
| occupied | In use | `--pos-state-occupied-*` (teal) |
| attention | Pending / held / bill waiting | `--pos-state-attention-*` (saffron) |
| success | Completed | `--pos-state-success-*` (green) |
| danger | Error / cancel | `--pos-state-danger-*` (red) |

Communicate state with **accent edge + status dot + tint + label**, never by filling the whole card. On the Billing rail, table tiles stay content surfaces; the rail is chrome, the tiles are content. In the Light theme those tiles stay light.

## Tokens

Application UI color lives in `src/ui/theme/tokens.css`. `:root` is the Light theme. Dark overrides only the color tokens under `html[data-theme="dark"]`. External identity (Swiggy, Zomato) and chart hues live in `src/ui/theme/external-brands.ts` and stay brand-true in both themes. Print-window ink lives in `src/ui/theme/print-html.ts` and stays light.

Shared CSS: `src/ui/theme/base.css` plus `src/ui/theme/components/*.css`. Theme is imported from `src/main.tsx`.

Primitives: `src/ui/components/ui/` (Button, Card, PageHeader, DataTable, Modal, Stat, Skeleton, Icon, SegmentedControl, …).

Button hierarchy: one teal primary (`variant="primary"`) per view, saffron only for the single accent action (`variant="accent"`), Cancel as `danger-ghost` when quiet destructive is needed.

Token check: `scripts/check-theme-tokens.cjs` runs as part of `npm run lint` and hard-fails on raw hex, gradients, emoji, and black `rgba(0,0,0,…)` in `src/ui` (except `tokens.css`, `external-brands.ts`, `print-html.ts`, and canvas logo processing).

## Accessibility (primitives)

Every primitive must provide:

- visible focus ring (`--pos-focus-ring`, or `--pos-focus-ring-inverse` on chrome)
- keyboard operation
- 40px hit target on POS surfaces, 32px in dense back office
- accessible name
- disabled, loading, and error states where applicable
- `StatusDot` always paired with text or `aria-label`

## UI contract (perf-ui.cjs)

Do not change these without updating `scripts/perf-ui.cjs` in the same commit.

### Element ids

- `app-root`
- `app-header`
- `main-content`
- `main-nav`
- `split-view`
- `tables-section`
- `billing-section`

### Class names

- `pos-ph-title` on page headings (screen detection)

### aria-label patterns

- `Table <n>` prefix on table tiles
- `Collect Payment` on the payments dialog

### Placeholders

- `Search item by name`
- `Search table`
- back-office search placeholders used by perf-ui

### Body text

- `No active order`
- `Amount Due`
- `Preview`
- `TOTAL SALES`

### Button labels used for lookup

- `Settle` (Billing primary — not “Pay”)
- `Done`
- `Reprint`
- `Export PDF`

### Integration surface

Preserve window events `select-table`, `orders-changed`, `branding-changed`, `service-modes-changed`, `hashchange`.

Preserve localStorage keys `currentOrderId`, `currentTable`, `lastPage`, `tablesLayoutMode`, `pos-appearance`.

Preserve Billing shortcuts `T`, `K`, `P`, `B`, `C`, `U`, `Ctrl+K` (Manage command palette; must not steal plain `K` on Billing), `Ctrl+Z`, and `1-6` favorites.

Reports live under Manage (`#reports`); top-nav Reports appears only for reports-without-manager roles.

## Manage back-office contract (frozen)

Manage extends Billing/Tables — it does not invent a second visual language. Tables, Billing and KOT Queue are not modified by Manage work. Light-theme token values in `:root` stay as they are. Dark values belong only in `tokens.css`. Shared primitives are extended additively only.

### Visual identity

RestoNiti must not resemble a generic SaaS admin dashboard. Prefer operational density: tables for registers, compact type, restrained spacing, shallow navigation (Area → Section → Tab), drawers for inspection, full panes for heavy editing, modals for confirm/pick. Never nest overlays.

Avoid: excessive cards, card grids as default, giant KPI tiles, decorative charts, pill-heavy nav, centered web-page columns, nested cards, gradients, glassmorphism, oversized headings, excess whitespace.

Sign-off gates: (1) Could this be mistaken for a generic SaaS dashboard? (2) Does it belong beside Billing and Tables?

### Layout

- App chrome fixed (unchanged).
- Manage rail collapses 240px ↔ 56px; visually recedes; active = restrained tint + saffron edge (not filled pills).
- Section header + tabs + toolbar = **one continuous workspace header** (hairline separators only; no card chrome on those bands).
- Only the content region scrolls.
- One visually dominant primary action when the context has one — do not invent actions (e.g. Audit has none).
- Content widths: reading/form ~880–960px left-aligned; operational ~1200–1400px; data-dense 100%. Never center a narrow column on wide desktops.
- Four surfaces only: workspace → content → interactive → overlay. Do not invent a fifth to separate content; use spacing/type/dividers first.
- Manage header contract: title (+ description) left; **one primary action** top-right when the section has a create/add action. Filters and secondary tools sit in the content toolbar band (or below tabs), not in a lonely full-width row.
- Density View toggle was removed — it only adjusted table padding and added chrome without clear benefit.
- `KpiRow`: max four headline values, inline (not dashboard tiles). Supporting primitive, not every screen's layout.

### Overlay allocation

- Drawer — inspect, light edit, quick actions.
- Full pane — heavy editors (buying list editor, large purchase entry).
- Modal — confirm, destroy, tiny forms, pickers.
- Never drawer↔modal nesting.

### Grocery domain

- Buying list status is **service-derived**. Clients may only send `draft→open` and `→cancelled`. `partial` / `completed` are rejected from clients.
- Prefer "pending" over "remaining" in procurement summaries.
- Never show a single "savings" number when qty and rate both changed.
- Unlinked purchases are first-class (`buying_list_id` optional).
- Void is the only way to remove a recorded purchase from profitability.
- v1 Expenses = operating expenses only (no CapEx / prepaid / accruals model).
