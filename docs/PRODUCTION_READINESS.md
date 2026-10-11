# Production Readiness

Use this checklist before installing the POS in a live restaurant.

For step-by-step procedures, see:

- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` for fresh desktop or restaurant desktop installation (includes **client OS/hardware requirements**).
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` for updates from 0.7.0 onward.
- `docs/UPDATE_0_6_0_TO_0_7_0.md` for the one-time upgrade from unlicensed 0.6.0.

## Client Machine Gate

Before scheduling install, confirm the restaurant PC against **Client requirements** in `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md`:

- Windows 10 or 11, **64-bit only** (not 7/8, not 32-bit, not S mode)
- **8 GB RAM** minimum, SSD with **20 GB** free
- Display at least **1366 × 768**
- USB and/or LAN path for ESC/POS printers; stable LAN if Captain phones are used

## Build Prerequisites

- Node.js 22.x
- Visual Studio 2022 Build Tools with the C++ desktop workload, MSVC toolchain, and Windows SDK
- Corporate TLS root CA trusted by Node:
  - Preferred on Windows: `npm run build:electron:system-ca`
  - Alternative: set `NODE_EXTRA_CA_CERTS` to a PEM file containing the company CA

## Required Checks

Run these from the repo root:

```powershell
npm run lint
npm test -- --runInBand
npm run build:renderer
npm run build:electron:system-ca
```

`npm run build:electron:system-ca` must produce a Windows installer under `release/`.

Restaurant installs must use an Authenticode-signed installer. Unsigned NSIS/Electron EXEs are blocked or warned by Windows Security (SmartScreen “Unknown publisher”, Defender quarantine). Set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` on the build machine, then confirm with `npm run verify:win-sign`. Deliver via USB or GitHub Releases link + SHA256 — never WhatsApp/email. See `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` §1.5 (signing), §2 (delivery), and §5.1 (SmartScreen).

## Clean Machine Smoke Test

On a Windows machine that is not the development machine:

- Install the generated app.
- Complete first-run admin setup.
- Log in as admin.
- Create a cashier user and verify cashier permissions.
- Configure branding, GST, table count, counter printer, and kitchen printer.
- Create a dine-in order, send KOT, pay, and print receipt.
- Create a takeaway order with customer phone, send KOT, pay, and print receipt.
- Unplug or disable a printer, send KOT, verify print job is queued, reconnect, and retry.
- Create a SQLite backup.
- Restore the backup on the same machine and verify orders/settings remain intact.
- Restart the app and verify login, open orders, paid history, and settings persist.

## Printer Acceptance

- Network printer target: use an IPv4 address and port `9100`.
- USB printer target: install the printer in Windows and use the exact Windows printer name.
- Print one kitchen KOT and one counter receipt.
- Confirm bold text, alignment, feed, cut, and no Windows page margins.

## Rollout Notes

- Keep a copy of the installer used for deployment.
- Record the configured Windows printer names for the restaurant.
- Record the backup location and restore procedure.

## Admin-Controlled Updates

- Configure `POS_UPDATE_MANIFEST_URL` on the restaurant machine to an HTTPS manifest:

```json
{
  "version": "1.1.0",
  "installerUrl": "https://updates.example.com/RestaurantPOS-1.1.0.exe",
  "sha256": "NEW_INSTALLER_SHA256",
  "rollbackInstallerUrl": "https://updates.example.com/RestaurantPOS-1.0.0.exe",
  "rollbackSha256": "CURRENT_INSTALLER_SHA256",
  "notes": ["Improved printing", "Performance fixes"]
}
```

- The rollback installer is mandatory. The app will not enable installer launch unless the new installer, rollback installer, and pre-update SQLite backup are all verified.
- Update files are cached under `%LOCALAPPDATA%\RestaurantPOS\Updates`.
- Before updating, Settings -> Update & Support warns about open orders, pending KOTs, and pending/failed print jobs.
- If rollback is needed from inside the app, use Settings -> Update & Support -> Roll Back Last Update.
- If the app cannot start, open `%LOCALAPPDATA%\RestaurantPOS\Updates`, read `ROLLBACK-INSTRUCTIONS.txt`, restore `pre-update.sqlite`, then run `rollback-installer.exe`.
