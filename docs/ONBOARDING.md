# Developer onboarding

Start here if you are new to this repo.

## What this app is

Single-restaurant, offline-first Electron POS. The renderer is React; persistence and OS features live in the Electron main process behind `window.pos`. See `README_ARCHITECTURE.md` for runtime shape, database, auth, orders, and printing.

## Repo map

| Path | Purpose |
| --- | --- |
| `electron/` | Main process: SQLite, IPC, printing, backups |
| `src/app/` | Renderer facade over `window.pos` (`posRepository.ts`) |
| `src/shared/` | DTOs, validation, GST, business-date helpers |
| `src/ui/` | React screens, hooks, and the design system |
| `src/config/` | Role registry and page labels |
| `docs/` | Product and operational runbooks |
| `scripts/` | Lint helpers (`check-theme-tokens.cjs`, `perf-ui.cjs`) |

## UI and design system

All product UI should follow **RestoNiti 2026**. Read `docs/design-system.md` before changing screens.

**Tokens and global CSS**

- `src/ui/theme/tokens.css` — `--pos-*` variables (colors, spacing, radius, shadows)
- `src/ui/theme/base.css` — reset, focus rings, skeleton utilities
- `src/ui/theme/components/*.css` — shared classes (`ui-btn`, `ui-input`, `ui-card`, …)

**React primitives** — import from `src/ui/components/ui/`:

- Layout: `PageHeader`, `Toolbar`, `Card`, `Drawer`, `Modal`
- Controls: `Button`, `Input`, `Select`, `SegmentedControl`
- Data: `DataTable`, `Stat`, `Skeleton`, `EmptyState`, `Badge`, `StatusDot`
- POS tiles: `MenuTile`, `FavoriteTile`, `TableTile`, `OrderItemRow`
- Icons: `Icon` wrapper around `lucide-react` (no emoji in product UI)

**Two valid button patterns**

1. **Preferred:** `<Button variant="primary" />` etc.
2. **Legacy (still supported):** `<button className="pos-btn ui-btn-primary">` — same CSS, use when migrating incrementally.

Do **not** add screen-local button/badge CSS that duplicates `buttons.css` or `status.css`. Use tokens, not raw hex or black shadows.

**Lint**

`npm run lint` runs ESLint and `scripts/check-theme-tokens.cjs`. The token check fails on raw hex, gradients, emoji, and black `rgba(0,0,0,…)` under `src/ui/` (with small exceptions for `tokens.css`, `external-brands.ts`, `print-html.ts`, and logo processing).

**Frozen UI contract**

Billing/Manage selectors, labels, and shortcuts are guarded by `scripts/perf-ui.cjs`. Do not rename contract elements without updating that script in the same commit. Details are in `docs/design-system.md`.

## Screen maturity (UI)

| Tier | Examples | Pattern |
| --- | --- | --- |
| Modern | Grocery, Expenses, Audit, Manager, Customers, History, ItemsEditor, Staff, Attendance, Users, LogSettings | `Button`, `Input`, `DataTable`, `Drawer`, `Modal` |
| Mixed | Settings, Reports, Login | Shared auth CSS + `Button` on actions; some dense forms still use `pos-input` |
| Legacy | — | Prefer migrating touched controls when editing a screen |

When you edit a legacy screen, prefer converting touched controls to design-system primitives in the same change.

## Local development

```powershell
npm install
npm run start
```

Useful checks:

```powershell
npm test
npm run build:renderer
node scripts/check-theme-tokens.cjs
```

## Related docs

- `README.md` — run, build, deployment
- `README_ARCHITECTURE.md` — system architecture
- `README_AUTH.md` — auth flows
- `docs/design-system.md` — visual rules and primitives
- `docs/APP_OVERVIEW.md` — product overview
