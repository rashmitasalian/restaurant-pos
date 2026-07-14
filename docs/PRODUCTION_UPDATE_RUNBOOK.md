# Production Update Runbook

**Repo:** `https://github.com/rashmitasalian/restaurant-pos`  
**Last updated:** 2026-07-14

---

## How the update system works

The POS app compares the **version embedded in the installed `.exe`** (set by `package.json` at build time) against the **`version` field in `manifest.json`**. If the manifest version is higher, the update is offered. Git tags play no role in this check — they are used only for GitHub Releases and human tracking.

---

## Part A — Deploy v0.2.0 (Current Release)

### Current state at time of writing

| Item | Status |
|---|---|
| All code changes committed and pushed | ✓ Done (`57793c9` on `origin/main`) |
| `v0.1.0` git tag created and pushed | ✓ Done |
| Rollback installer built | ✓ Done (`archive\RestoNiti Setup 0.1.0.exe`) |
| `package.json` version bumped to `0.2.0` | ✗ Still needed |
| `v0.2.0` git tag | ✗ Still needed |
| `0.2.0` installer built | ✗ Still needed |
| GitHub Releases created | ✗ Still needed |
| `manifest.json` published | ✗ Still needed |
| Update applied at restaurant | ✗ Still needed |

---

### Step 1 — Bump the version to 0.2.0

Open PowerShell in the repo root:

```powershell
cd "C:\Users\Rashmita.Salian\OneDrive - Wolters Kluwer\Pictures\restaurant-pos"
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 0.2.0"
git push origin main
```

Verify:

```powershell
Get-Content package.json | Select-String '"version"'
# Expected: "version": "0.2.0"
```

---

### Step 2 — Create and push the v0.2.0 git tag

```powershell
git tag v0.2.0
git push origin v0.2.0
```

Verify on GitHub: `https://github.com/rashmitasalian/restaurant-pos/tags`

---

### Step 3 — Build the v0.2.0 installer

> Run on a Windows machine with Node.js 22, Visual Studio 2022 Build Tools (C++ workload + MSVC + Windows SDK) installed.

```powershell
npm ci
npm run build
```

Expected output:

```
release\RestoNiti Setup 0.2.0.exe
```

If you get a TLS error on a corporate network, prepend:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run build
```

---

### Step 4 — Compute SHA256 hashes for both installers

```powershell
Get-FileHash "release\RestoNiti Setup 0.2.0.exe"    -Algorithm SHA256 | Select-Object Hash
Get-FileHash "archive\RestoNiti Setup 0.1.0.exe"    -Algorithm SHA256 | Select-Object Hash
```

Note both values — you will need them in Steps 6 and 7.

Also note the file sizes in bytes:

```powershell
(Get-Item "release\RestoNiti Setup 0.2.0.exe").Length
(Get-Item "archive\RestoNiti Setup 0.1.0.exe").Length
```

---

### Step 5 — Create GitHub Releases and upload the installers

> ⚠️ Do **not** commit `.exe` files to git. Electron installers exceed 100 MB. The `archive/` and `release/` folders are gitignored. GitHub Releases supports up to 2 GB per asset and serves files over HTTPS.

**Create the v0.1.0 release (rollback installer):**

1. Go to `https://github.com/rashmitasalian/restaurant-pos/releases/new`
2. Choose existing tag `v0.1.0`
3. Title: `v0.1.0 — Initial production release`
4. Attach `archive\RestoNiti Setup 0.1.0.exe`
5. Click **Publish release**
6. Click the uploaded asset and copy the download URL — it will look like:
   ```
   https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.1.0/RestoNiti.Setup.0.1.0.exe
   ```

**Create the v0.2.0 release (new installer):**

1. Go to `https://github.com/rashmitasalian/restaurant-pos/releases/new`
2. Choose existing tag `v0.2.0`
3. Title: `v0.2.0`
4. Add release notes:
   ```
   - Separate Print Bill and Pay buttons — bill can be printed before payment is recorded
   - Pay button records payment mode and clears the table only
   - Print receipt checkbox on payment modal (unchecked by default)
   - Order item +/- buttons are keyboard accessible; minus disabled at minimum quantity
   - Delivery bill button renamed to Print Bill for consistency
   ```
5. Attach `release\RestoNiti Setup 0.2.0.exe`
6. Click **Publish release**
7. Click the uploaded asset and copy the download URL — it will look like:
   ```
   https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.2.0/RestoNiti.Setup.0.2.0.exe
   ```

> **Note:** GitHub replaces spaces with `.` in asset download URLs. Always copy the URL by clicking the asset rather than constructing it manually.

---

### Step 6 — Publish the update manifest

Create `manifest.json` with the values collected above and publish it at a stable HTTPS URL that the POS app is configured to check.

```json
{
  "version": "0.2.0",
  "installerUrl": "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.2.0/RestoNiti.Setup.0.2.0.exe",
  "sha256": "<PASTE_0.2.0_SHA256_HERE>",
  "rollbackInstallerUrl": "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.1.0/RestoNiti.Setup.0.1.0.exe",
  "rollbackSha256": "<PASTE_0.1.0_SHA256_HERE>",
  "installerSizeBytes": <PASTE_0.2.0_SIZE_IN_BYTES>,
  "rollbackInstallerSizeBytes": <PASTE_0.1.0_SIZE_IN_BYTES>,
  "notes": [
    "Separate Print Bill and Pay buttons — bill can be printed before payment is recorded",
    "Pay button records payment mode and clears the table only",
    "Print receipt checkbox on payment modal (unchecked by default)",
    "Order item +/- buttons are keyboard accessible; minus disabled at minimum quantity",
    "Delivery bill button renamed to Print Bill for consistency"
  ]
}
```

Before going to the restaurant, verify both installer URLs are reachable:

```powershell
Invoke-WebRequest -Uri "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.2.0/RestoNiti.Setup.0.2.0.exe" -Method Head
Invoke-WebRequest -Uri "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.1.0/RestoNiti.Setup.0.1.0.exe" -Method Head
# Both must return StatusCode 200
```

---

### Step 7 — Apply the update at the restaurant

Do this during a quiet period (after close or between service periods).

**Before starting:**
- [ ] Restaurant is closed or quiet — no active orders
- [ ] Windows admin credentials available for UAC prompt
- [ ] Machine has internet access to GitHub

**At the POS machine:**

1. Log in as **admin**
2. Open **Settings → Update & Support**
3. Click **Check for Updates** — confirm version `0.2.0` and the release notes appear
4. Click **Prepare Update** — the app will:
   - back up the database to `pre-update.sqlite`
   - download and verify both installers
   - verify SHA256 checksums
5. Once preparation is complete and **Launch Installer** becomes active, click it
6. Confirm the POS will close
7. Approve the Windows UAC prompt
8. Complete the installer wizard
9. Reopen **Restaurant POS**

Expected status after restart: **Update Successful** (or **Update Successful With Warnings** — warnings are non-critical, e.g. missing printer config)

---

### Step 8 — Smoke test

1. Log in
2. Open the Tables screen
3. Add a test order to a table
4. Send a KOT
5. Click **Print Bill** — verify it prints without recording payment
6. Click **Pay** → select a method → confirm — verify the table clears
7. Check **History** — confirm the order appears
8. Check **Reports** — confirm totals update
9. Verify the printer queue is readable

---

### Step 9 — Record the release

| Field | Value |
|---|---|
| Version | `0.2.0` |
| Baseline (rollback) commit | `6ce2770` → tag `v0.1.0` |
| Release commit | run `git rev-parse v0.2.0` after tagging |
| GitHub release | `https://github.com/rashmitasalian/restaurant-pos/releases/tag/v0.2.0` |
| Deployed by | |
| Deployed at | |
| Smoke test result | |

---

## Part B — Rollback

Use rollback only if the updated app is not usable after installation. Rollback is one generation only.

### Option 1 — Rollback from inside the app

1. Log in as **admin**
2. Open **Settings → Update & Support**
3. Click **Roll Back Last Update**
4. Review the warning about orders and payments created since the update
5. Confirm only if losing those records is acceptable

The app will restore `pre-update.sqlite`, launch `rollback-installer.exe`, and close. Complete the installer and restart.

### Option 2 — Break-glass rollback (app will not start)

1. Close the POS process completely
2. Open `%LOCALAPPDATA%\RestaurantPOS\Updates`
3. Open `ROLLBACK-INSTRUCTIONS.txt` and follow it exactly
4. Critical order: **restore `pre-update.sqlite` before running `rollback-installer.exe`**
5. Run `rollback-installer.exe`
6. Restart the POS

---

## Part C — Future Releases

For every subsequent release, follow this checklist:

### C.1 Prepare code

```powershell
git status --short --branch
npm run lint
npm test -- --runInBand
npm run build:renderer
```

Fix all failures before packaging.

### C.2 Bump version, commit, tag

```powershell
npm version <NEW_VERSION> --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to <NEW_VERSION>"
git push origin main
git tag v<NEW_VERSION>
git push origin v<NEW_VERSION>
```

### C.3 Build

```powershell
npm ci
npm run build
```

### C.4 Compute hashes

```powershell
Get-FileHash "release\RestoNiti Setup <NEW_VERSION>.exe" -Algorithm SHA256 | Select-Object Hash
(Get-Item "release\RestoNiti Setup <NEW_VERSION>.exe").Length
```

### C.5 Create GitHub Release

Upload `release\RestoNiti Setup <NEW_VERSION>.exe` as an asset on the new release. Keep the previous release and its installer for use as the rollback.

### C.6 Publish manifest

Update `manifest.json`:
- `version` → new version
- `installerUrl` → new installer GitHub asset URL
- `sha256` → new installer hash
- `rollbackInstallerUrl` → previous release's installer URL
- `rollbackSha256` → previous release's installer hash
- `notes` → what changed

### C.7 Deploy and smoke test

Follow **Part A Steps 7–9** above.

### C.8 Archive record

| Field | Value |
|---|---|
| Version | |
| Release commit / tag | |
| GitHub release URL | |
| SHA256 (new installer) | |
| SHA256 (rollback installer) | |
| Deployed by | |
| Deployed at | |
| Smoke test result | |
