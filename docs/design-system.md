# RestoNiti 2026 design system

RestoNiti 2026 is a visual and component-system modernization, not a redesign of product behavior: preserve workflows, shortcuts, data, printing, GST and authentication while establishing a restrained teal-first POS design language that is fast to scan, touch-friendly, keyboard-accessible and resistant to visual drift.

## Locked visual rules

- **Deep teal** (`--pos-teal` / `--pos-chrome`) is structure: top bar, Billing rail, primary actions, occupied state.
- **Saffron** (`--pos-saffron`) is a spark: one accent action per view, attention / held only.
- **Warm light** workspace: `--pos-bg: #F9F8F6`, `--pos-surface: #FFFFFF`.
- Text ramp: `#17202A` / `#3F4A56` / `#64748B` / `#94A3B8`. Borders: `#E3E5E4` / `#CBD2D0`.
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

Communicate state with **accent edge + status dot + light tint + label**, never by filling the whole card. On the teal Billing rail, table tiles stay light surfaces; the rail is chrome, the tiles are content.

## Tokens

Application UI color lives in `src/ui/theme/tokens.css`. External identity (Swiggy, Zomato) and `CHART_RAMP` live in `src/ui/theme/external-brands.ts`. Print-window ink lives in `src/ui/theme/print-html.ts`.

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

Preserve localStorage keys `currentOrderId`, `currentTable`, `lastPage`, `tablesLayoutMode`.

Preserve Billing shortcuts `T`, `K`, `P`, `B`, `C`, `U`, `Ctrl+Z`, and `1-6` favorites.
