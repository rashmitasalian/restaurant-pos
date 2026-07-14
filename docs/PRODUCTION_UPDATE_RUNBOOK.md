# Production Update Runbook

Use this runbook after Restaurant POS is already installed and a newer code release needs to be redeployed through the admin-controlled update flow.

Updates are started by an admin from `Settings -> Update & Support`. They are not silent or automatic.

---

## 0. Deploy The Current Working Version (Quick Steps)

> **Repo:** `https://github.com/rashmitasalian/restaurant-pos`
> **Current package version:** `0.1.0`
> **Branch:** `main`

All code changes are already committed and pushed to `origin/main`. Follow these steps in order.

### 0.1 Confirm Working Tree Is Clean And Synced

```powershell
cd "C:\path\to\restaurant-pos"
git status --short --branch
git fetch origin
git diff --stat HEAD origin/main
```

Expected: no uncommitted files, and no diff with `origin/main`. If there are local changes, commit and push them first.

### 0.2 Bump The Version

The update system requires a version higher than what is currently installed. Choose your next version (e.g. `0.2.0`):

```powershell
npm version 0.2.0 --no-git-tag-version
```

Commit and push the version bump:

```powershell
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0"
git push origin main
```

### 0.3 Create A Git Release Tag

```powershell
git tag v0.2.0
git push origin v0.2.0
```

### 0.4 Install Dependencies And Build The Installer

Run on a Windows machine with Node.js 22, Visual Studio Build Tools, and the Windows SDK installed:

```powershell
npm ci
npm run build
```

Expected output file:

```text
release\Restaurant POS Setup 0.2.0.exe
```

If the build fails with a TLS error on corporate networks:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run build
```

### 0.5 Create A GitHub Release And Upload The Installer

1. Go to: `https://github.com/rashmitasalian/restaurant-pos/releases/new`
2. Select tag `v0.2.0`.
3. Set title: `v0.2.0`.
4. Paste the release notes (see § 0.8 below for the current change list).
5. Attach `release\Restaurant POS Setup 0.2.0.exe` as a release asset.
6. Click **Publish release**.

Copy the direct download URL for the uploaded `.exe` — you will need it in the next step.

### 0.6 Compute SHA256 Hashes

```powershell
Get-FileHash "release\Restaurant POS Setup 0.2.0.exe" -Algorithm SHA256
Get-FileHash "archive\Restaurant POS Setup 0.1.0.exe" -Algorithm SHA256
```

Note both hash values exactly. If you do not have the `0.1.0` installer archived, retrieve it from the previous GitHub release.

### 0.7 Upload Installers To HTTPS Hosting And Publish The Manifest

Upload both installers to your static HTTPS host, then create or replace `manifest.json`:

```json
{
  "version": "0.2.0",
  "installerUrl": "https://<your-host>/restaurant-pos/RestaurantPOS-0.2.0.exe",
  "sha256": "<SHA256_OF_0.2.0_INSTALLER>",
  "rollbackInstallerUrl": "https://<your-host>/restaurant-pos/RestaurantPOS-0.1.0.exe",
  "rollbackSha256": "<SHA256_OF_0.1.0_INSTALLER>",
  "installerSizeBytes": 0,
  "rollbackInstallerSizeBytes": 0,
  "notes": [
    "Separate Print Bill and Pay buttons — bill can now be printed before payment",
    "Pay button only records payment mode and clears the table",
    "Print receipt checkbox on payment modal (unchecked by default)",
    "Order item +/- buttons: keyboard accessible, disabled state at minimum quantity",
    "Delivery bill button renamed to Print Bill for consistency"
  ]
}
```

Replace `<your-host>`, `<SHA256_OF_0.2.0_INSTALLER>`, `<SHA256_OF_0.1.0_INSTALLER>`, and `installerSizeBytes` values with actuals.
Publish the manifest only after both installer URLs are publicly reachable via HTTPS.

### 0.8 Run The Update At The Restaurant

Follow **§ 3 Run The Update At The Restaurant** below.

### 0.9 Archive This Release

| Field | Value |
|---|---|
| Source commit | `23cf09d` (or run `git rev-parse HEAD`) |
| Version | `0.2.0` |
| GitHub release | `https://github.com/rashmitasalian/restaurant-pos/releases/tag/v0.2.0` |
| Change summary | Print Bill / Pay separation, receipt print toggle, accessibility fixes |

---

## 1. Prepare A New Code Release

### 1.1 Finish And Verify Code Changes

From the repo root:

```powershell
git status --short --branch
npm run lint
npm test -- --runInBand
npm run build:renderer
```

Fix all failures before packaging.

### 1.2 Bump The App Version

The update system compares the manifest version against the installed app version. Every production release must have a higher version.

Example:

```powershell
npm version 1.1.0 --no-git-tag-version
```

This updates `package.json` and `package-lock.json`.

If your team tags releases in Git, create the tag after the build is accepted:

```powershell
git tag v1.1.0
```

### 1.3 Build The New Installer

From the repo root:

```powershell
npm run build
```

Expected output:

```text
release\Restaurant POS Setup 1.1.0.exe
```

Keep this installer permanently in the release archive.

## 2. Prepare Update Artifacts

### 2.1 Identify The Rollback Installer

For version `1.1.0`, the rollback installer is the currently installed production version, for example:

```text
Restaurant POS Setup 1.0.0.exe
```

The rollback installer is mandatory. Do not publish the update manifest until both installers are available.

### 2.2 Compute SHA256 Hashes

Run:

```powershell
Get-FileHash "release\Restaurant POS Setup 1.1.0.exe" -Algorithm SHA256
Get-FileHash "archive\Restaurant POS Setup 1.0.0.exe" -Algorithm SHA256
```

Copy the hash values exactly.

### 2.3 Upload Installers To HTTPS Hosting

Upload both installers to static HTTPS hosting:

```text
https://updates.example.com/restaurant-pos/RestaurantPOS-1.1.0.exe
https://updates.example.com/restaurant-pos/RestaurantPOS-1.0.0.exe
```

The app rejects non-HTTPS manifest and installer URLs.

### 2.4 Publish The Manifest

Create or replace:

```text
https://updates.example.com/restaurant-pos/manifest.json
```

Example:

```json
{
  "version": "1.1.0",
  "installerUrl": "https://updates.example.com/restaurant-pos/RestaurantPOS-1.1.0.exe",
  "sha256": "NEW_INSTALLER_SHA256",
  "rollbackInstallerUrl": "https://updates.example.com/restaurant-pos/RestaurantPOS-1.0.0.exe",
  "rollbackSha256": "CURRENT_PRODUCTION_INSTALLER_SHA256",
  "installerSizeBytes": 120000000,
  "rollbackInstallerSizeBytes": 120000000,
  "notes": [
    "Improved printing reliability",
    "Updated reports screen"
  ]
}
```

Rules:

- `version` must be greater than the installed app version.
- `installerUrl` must use HTTPS.
- `rollbackInstallerUrl` must use HTTPS.
- `sha256` must match the new installer bytes.
- `rollbackSha256` must match the rollback installer bytes.
- Publish the manifest only after both installer URLs are reachable.

## 3. Run The Update At The Restaurant

Perform this during a quiet operating window.

### 3.1 Before Starting

1. Confirm the restaurant has closed or is in a quiet period.
2. Confirm there are no critical open orders.
3. Confirm printers are online if possible.
4. Confirm Windows admin/UAC approval is available.
5. Confirm the machine has internet access to the HTTPS update host.

### 3.2 Check And Prepare Update

In the POS app:

1. Log in as admin.
2. Open `Settings -> Update & Support`.
3. Click `Check for Updates`.
4. Confirm the expected new version and release notes appear.
5. Click `Prepare Update`.
6. If business activity is detected, review:
   - open orders;
   - pending KOTs;
   - pending print jobs;
   - failed print jobs.
7. Continue only if the restaurant accepts the operational risk.

During prepare, the app:

- validates free disk space;
- creates `pre-update.sqlite`;
- validates the backup using SQLite header and integrity check;
- downloads or verifies `installer.exe`;
- downloads or verifies `rollback-installer.exe`;
- verifies SHA256 for both installers;
- writes rollback instructions.

Prepared files are stored under:

```text
%LOCALAPPDATA%\RestaurantPOS\Updates
```

Expected files:

```text
manifest.json
installer.exe
rollback-installer.exe
pre-update.sqlite
ROLLBACK-INSTRUCTIONS.txt
state.json
diagnostics\
```

`Launch Installer` remains disabled until the backup, new installer, and rollback installer are all verified.

### 3.3 Launch And Complete Installer

1. Click `Launch Installer`.
2. Confirm the POS will close.
3. Approve Windows UAC if prompted.
4. Complete the installer.
5. Reopen `Restaurant POS`.

On startup, the app runs a lightweight health check:

- SQLite opens;
- `PRAGMA integrity_check` passes;
- an active admin account exists;
- required settings load;
- `print_jobs` table can be queried;
- pending/failed print job counts can be queried.

Expected status in `Settings -> Update & Support`:

```text
Update Successful
```

or:

```text
Update Successful With Warnings
```

Warnings can include missing printer configuration or pending/failed print jobs.

### 3.4 Post-Update Smoke Test

After the update:

1. Log in.
2. Open tables.
3. Create a small test order.
4. Send KOT.
5. Take payment.
6. Print receipt.
7. Verify history/reports.
8. Confirm printer queue is readable.
9. Create a fresh SQLite backup.

## 4. Rollback

Rollback is one-generation only and admin-only.

Use rollback if the updated app is not usable after installation.

### 4.1 Rollback From Inside The App

1. Log in as admin.
2. Open `Settings -> Update & Support`.
3. Click `Roll Back Last Update`.
4. Review the warning:
   - orders created after the update;
   - payments created after the update.
5. Confirm only if losing post-update records is acceptable.

The app then:

- creates `emergency-backup.sqlite`;
- closes SQLite;
- restores `pre-update.sqlite`;
- deletes active SQLite `-wal` and `-shm` files;
- launches `rollback-installer.exe`;
- closes POS.

Complete the rollback installer and restart POS.

### 4.2 Break-Glass Rollback If The App Cannot Start

1. Close POS completely.
2. Open:

```text
%LOCALAPPDATA%\RestaurantPOS\Updates
```

3. Open `ROLLBACK-INSTRUCTIONS.txt`.
4. Follow the file-copy steps exactly.
5. Run:

```text
rollback-installer.exe
```

6. Restart POS.

Important order:

```text
Restore pre-update.sqlite before running rollback-installer.exe.
```

## 5. Release Archive Checklist

For every production release, archive:

- source commit SHA;
- app version;
- new installer;
- rollback installer;
- SHA256 hash for both installers;
- published manifest;
- release notes;
- smoke-test result;
- restaurant deployment date/time;
- person who approved the update.

This archive is required for support and rollback confidence.
