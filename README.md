# Restaurant POS

Electron + React + TypeScript desktop POS for a single restaurant.

## Current Stack

- Renderer: React 18 + Vite
- Main process: Electron IPC boundary
- Database: SQLite in the Electron main process via `better-sqlite3`
- Printing: raw ESC/POS bytes over TCP printer IP or Windows Winspool RAW printer name
- Auth: main-process credential hashing and in-memory session tokens exposed through preload IPC

## How To Run

```powershell
npm install
npm run start
```

## Useful Checks

```powershell
npm test
npm run lint
npm run build:renderer
npm run build:electron
npm run rebuild:electron
```

## UI and design system

Product UI follows **RestoNiti 2026**. New work should use components and tokens from `src/ui/components/ui/` and `src/ui/theme/`. See `docs/design-system.md` for rules and `docs/ONBOARDING.md` if you are starting on the codebase today.

`npm run build:electron` rebuilds native modules for Electron. Run `npm run rebuild:electron` if
`better-sqlite3` binaries are compiled against a different Node/Electron version during development.
On corporate networks with self-signed TLS inspection, use `npm run build:electron:system-ca` if the
company root CA is installed in Windows, or set `NODE_EXTRA_CA_CERTS` to a PEM file containing the trusted CA.
Packaging also requires Visual Studio 2022 Build Tools with the C++ desktop workload so
`better-sqlite3` can be rebuilt for Electron.

Do not disable npm TLS verification in the repo. On corporate networks, install the corporate
root CA into the OS/Node trust store or set `NODE_EXTRA_CA_CERTS` locally.

## Runtime Notes

- Renderer code reaches persistence and OS features through `window.pos` only.
- The SQLite database is stored under Electron `userData` as `data/restaurant-pos.sqlite`.
- `.env` values are loaded by both Vite and the Electron main process.
- For USB thermal printers, install the printer in Windows and use the Windows printer name. The app sends RAW bytes through Winspool `WritePrinter`. Network printers can use their IPv4 address and port.
- Production updates are admin-triggered from Settings. Set `POS_UPDATE_MANIFEST_URL` to an HTTPS manifest; the app verifies installer SHA256 hashes and requires a cached rollback installer before launching an update.

## Production Deployment

See:

- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` for fresh desktop or restaurant desktop installation.
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` for code redeploy, production update, and rollback.
