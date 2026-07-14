# Production Update Runbook

Use this runbook after Restaurant POS is already installed and a newer code release needs to be redeployed through the admin-controlled update flow.

Updates are started by an admin from `Settings -> Update & Support`. They are not silent or automatic.

---

## 0. Deploy The Current Working Version (Quick Steps)

> **Repo:** `https://github.com/rashmitasalian/restaurant-pos`
> **Current package version:** `0.1.0` — must be bumped before building
> **Branch:** `main` (HEAD: `fedfd39`)
> **Git tags:** none yet — see notes below

### How the update system works (important)

The update system compares the **version embedded in the installed `.exe`** against the **`version` field in `manifest.json`**. It does **not** use git tags. Git tags are only needed to create GitHub Releases and for human tracking/rollback reference.

Because every commit currently has `"version": "0.1.0"` in `package.json`, you **must** bump the version before building — otherwise the new installer will also embed `0.1.0` and the update system will see installed = manifest and skip the update.

---

### Step 1 — Push any uncommitted changes

```powershell
cd "C:\path\to\restaurant-pos"
git status --short --branch
```

If the tree is clean and already in sync with `origin/main`, skip ahead. Otherwise:

```powershell
git add .
git commit -m "chore: finalise changes before 0.2.0 release"
git push origin main
```

---

### Step 2 — Retroactively tag the installed baseline as v0.1.0

The restaurant machine has an app built from the July 11 commit `6ce2770` (last commit before the July 14 feature additions). Tag it now so you can track it and rebuild a rollback installer if needed:

```powershell
git tag v0.1.0 6ce2770
git push origin v0.1.0
```

This does **not** change any code — it is a label only.

---

### Step 3 — Rebuild the v0.1.0 rollback installer (if you don't already have it)

You need the rollback installer (the one matching what is currently on the restaurant machine) before publishing any update. If you kept the original `.exe` from the first installation, archive it and skip this step. Otherwise rebuild it:

```powershell
# Check out the 0.1.0 baseline — this is read-only, your main branch is untouched
git checkout 6ce2770

npm ci
npm run build

# Save the output before switching back
mkdir -p archive
Copy-Item "release\Restaurant POS Setup 0.1.0.exe" "archive\Restaurant POS Setup 0.1.0.exe"

# Return to main
git checkout main
```

---

### Step 4 — Bump the version to 0.2.0

```powershell
npm version 0.2.0 --no-git-tag-version
```

This updates `package.json` and `package-lock.json` only. Commit and push:

```powershell
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0"
git push origin main
```

---

### Step 5 — Tag v0.2.0

```powershell
git tag v0.2.0
git push origin v0.2.0
```

---

### Step 6 — Build the v0.2.0 installer

```powershell
npm ci
npm run build
```

Expected output:

```text
release\Restaurant POS Setup 0.2.0.exe
```

If you get a TLS error on a corporate network:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run build
```

---

### Step 7 — Create a GitHub Release and upload both installers

1. Go to: `https://github.com/rashmitasalian/restaurant-pos/releases/new`
2. Select tag `v0.2.0`.
3. Title: `v0.2.0`
4. Paste release notes (see § 0.9).
5. Attach `release\Restaurant POS Setup 0.2.0.exe`.
6. Click **Publish release**.
7. Repeat for `v0.1.0` — attach `archive\Restaurant POS Setup 0.1.0.exe` to that release (or just keep it available at an HTTPS URL).

---

### Step 8 — Compute SHA256 hashes

```powershell
Get-FileHash "release\Restaurant POS Setup 0.2.0.exe" -Algorithm SHA256
Get-FileHash "archive\Restaurant POS Setup 0.1.0.exe" -Algorithm SHA256
```

Copy both hash strings exactly.

---

### Step 9 — Publish the update manifest

Upload both `.exe` files to static HTTPS hosting (GitHub Releases asset URLs work). Then publish `manifest.json` at your manifest host URL:

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
    "Separate Print Bill and Pay buttons — bill can now be printed before payment is recorded",
    "Pay button only records payment mode and clears the table",
    "Print receipt checkbox on payment modal (unchecked by default)",
    "Order item +/- keyboard accessible; minus button disabled at minimum quantity",
    "Delivery bill button renamed to Print Bill for consistency"
  ]
}
```

Replace all `<placeholder>` values. Publish the manifest only after both installer URLs return HTTP 200.

> **Tip:** GitHub Release asset URLs are stable HTTPS URLs and can be used directly as `installerUrl` / `rollbackInstallerUrl`.

---

### Step 10 — Run the update at the restaurant

Follow **§ 3 Run The Update At The Restaurant** below.

---

### Step 11 — Archive this release

| Field | Value |
|---|---|
| Baseline commit (v0.1.0) | `6ce2770` |
| Release commit (v0.2.0) | `fedfd39` (or run `git rev-parse v0.2.0`) |
| GitHub release | `https://github.com/rashmitasalian/restaurant-pos/releases/tag/v0.2.0` |
| Change summary | Print Bill / Pay separation, receipt print toggle, keyboard accessibility |

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
