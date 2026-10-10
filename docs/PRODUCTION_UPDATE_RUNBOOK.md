# Production Update Runbook

**Repo:** `https://github.com/rashmitasalian/restaurant-pos`  
**This upgrade:** installed **0.6.0** → **0.7.0**  
**Last updated:** 2026-10-10

`package.json` and `manifest.json` are still `0.6.0`. The app will not offer an update until both are bumped. Git tag `v0.6.0` is commit `72887f0` (2026-09-05). `main` is 42 commits ahead of that tag and still reports version `0.6.0`.

Related: `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` (new PCs and license issuance).

---

## How the update system works

The installed `.exe` version comes from `package.json` at build time. Settings → **Update & Support** compares that version with the `version` field in `manifest.json` at `POS_UPDATE_MANIFEST_URL`. A higher manifest version is offered. Git tags are only for GitHub Releases.

From **0.7.0** onward, Check for Updates rejects a manifest that has no valid Ed25519 `signature`. The 0.6.0 app ignores that field, so a signed manifest is still readable by 0.6.0.

---

## Why this upgrade is not a normal in-app update

0.7.0 is the first build that requires a license, and the first build that encrypts the database.

- Until a `.rnlc` file is imported, the POS and Captain do not start. The database is not opened yet, so a failed license visit does not encrypt or migrate it.
- The first successful open copies `restaurant-pos.sqlite` to SQLCipher, writes `restaurant-pos.sqlite.key` beside it, and deletes the plaintext file. The key is wrapped with the Windows login secret in `%APPDATA%\Restaurant POS\Local State`.
- 0.6.0 cannot open that encrypted file. Rollback only works from a plaintext copy taken **before** the new app opens the database.
- Do **not** publish `manifest.json` version `0.7.0` before the restaurant is licensed. The live URL is `main` on GitHub. The 0.6.0 app would download 0.7.0, restart into the activation screen, and could not bill until you issue a license.

Install this build on site, with the license issuer on your laptop, in the same visit.

---

## Before you leave home

### 1. Confirm the keys match this source tree

License private key (already used for this app’s embedded license public key):

```text
%USERPROFILE%\.restoniti\license-ed25519.pem
%USERPROFILE%\.restoniti\license-ledger.jsonl
```

Update-manifest private key (separate from the license key):

```text
%USERPROFILE%\.restoniti\update-ed25519.pem
```

```powershell
cd "C:\Users\rashm\Documents\RestoNiti\restaurant-pos"
npm run license:keygen
npm run update:keygen
```

Both commands must say the existing key **matches** the public key in `electron/licensing/publicKey.ts`. If `update:keygen` creates a new key, it prints a public key that is not in the app yet. Paste that value into `UPDATE_PUBLIC_KEY_BASE64`, then build. Do not sign a manifest with a key that does not match the exe you are about to install.

Do not commit private keys, the ledger, or `.rnlc` files.

### 2. Build 0.7.0

Node.js **24.x** (see `package.json` `engines`). Visual Studio 2022 Build Tools with the C++ workload, MSVC, and the Windows SDK.

```powershell
git status --short --branch
npm ci
npm run lint
npm test -- --runInBand
npm version 0.7.0 --no-git-tag-version
npm run build
```

On a network that intercepts TLS:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run build
```

Expected file:

```text
release\RestoNiti Setup 0.7.0.exe
```

If you have the code-signing certificate, set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` before `npm run build`, then run `npm run verify:win-sign`. Never commit the PFX or the password.

### 3. Hash the new installer and the 0.6.0 rollback installer

Keep the installer that is actually on the restaurant PC. That is the GitHub asset for tag `v0.6.0`, not `v0.5.6`.

```powershell
Get-FileHash "release\RestoNiti Setup 0.7.0.exe" -Algorithm SHA256 | Select-Object Hash
(Get-Item "release\RestoNiti Setup 0.7.0.exe").Length
Get-FileHash "archive\RestoNiti Setup 0.6.0.exe" -Algorithm SHA256 | Select-Object Hash
(Get-Item "archive\RestoNiti Setup 0.6.0.exe").Length
```

If `archive\RestoNiti Setup 0.6.0.exe` is not the file that was installed, download the asset from the `v0.6.0` GitHub Release and hash that file instead.

### 4. Tag and publish the installer, but not the live manifest

```powershell
git add package.json package-lock.json
git commit -m "chore: bump version to 0.7.0"
git push origin main
git tag v0.7.0
git push origin v0.7.0
```

Create the GitHub Release for existing tag `v0.7.0`. Attach `release\RestoNiti Setup 0.7.0.exe`. Do not commit the exe. Copy the asset URL from the release page (GitHub turns spaces into dots). Confirm the `v0.6.0` release still has its installer attached.

Leave `manifest.json` on `main` at version `0.6.0` until step 8.

### 5. Prepare the manifest locally and sign it

Save this as a file **outside** the repo, for example `%USERPROFILE%\Desktop\manifest-0.7.0.json`. Fill in the hashes and sizes from step 3. Use the asset URLs you copied.

```json
{
  "version": "0.7.0",
  "installerUrl": "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.7.0/RestoNiti.Setup.0.7.0.exe",
  "sha256": "<0.7.0 SHA256>",
  "rollbackInstallerUrl": "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.6.0/RestoNiti.Setup.0.6.0.exe",
  "rollbackSha256": "<0.6.0 SHA256>",
  "installerSizeBytes": 0,
  "rollbackInstallerSizeBytes": 0,
  "notes": [
    "One-time license activation for this PC",
    "Database encrypted on first open",
    "Kitchen notes on order lines and KOT",
    "Percent and fixed-amount discounts",
    "Customer credit ledger and split-payment credit",
    "QR code on the bill, menu import, diet labels, logo and appearance",
    "Staff roster export, table filters, Captain QR pairing"
  ]
}
```

```powershell
npm run update:sign -- --manifest "$env:USERPROFILE\Desktop\manifest-0.7.0.json"
```

The file should now contain a `signature` field. Do not push it yet.

Take to the restaurant:

- `RestoNiti Setup 0.7.0.exe` on USB (do not rely on the in-app updater)
- This laptop, with the license private key, so you can issue the `.rnlc` on the spot
- A blank USB folder for the database copy

---

## At the restaurant

Do this after close, or with no open orders. Windows admin is required for UAC. Use the same Windows account that runs RestoNiti every day.

### 6. Two-minute check, then copy the database

1. Open the current app and log in as admin.
2. If it already shows **Installation Code**, or Settings already has **License**, this PC is not the unlicensed 0.6.0 path. Stop and use **Already licensed** at the bottom.
3. Confirm there are no open tables you still need.
4. Close RestoNiti completely. Confirm it is gone in Task Manager.
5. Copy these files to the USB. The app must stay closed.

```text
%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite
%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite-wal
%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite-shm
```

The `-wal` and `-shm` files may be absent. Copy them if they exist. Leave the originals in place. Do not delete `%APPDATA%\Restaurant POS`, `Local State`, or anything under `license\`.

### 7. Install, activate, then let the database migrate

1. Run `RestoNiti Setup 0.7.0.exe` as administrator. Approve UAC. Install over `C:\Program Files\RestoNiti\`.
2. Start RestoNiti. It shows **Installation Code** and does not open the POS. Captain does not start. The database is still the plaintext file.
3. Copy the full code. On your laptop:

```powershell
cd "C:\Users\rashm\Documents\RestoNiti\restaurant-pos"
npm run license:issue -- --customer "Restaurant Name" --code "RN1-...." --out "$env:USERPROFILE\Desktop\Restaurant-Name.rnlc"
npm run license:verify -- --file "$env:USERPROFILE\Desktop\Restaurant-Name.rnlc"
```

4. On their PC, choose that `.rnlc`. It is stored at `%APPDATA%\Restaurant POS\license\license.rnlc`.
5. Log in with the existing admin account. Do not run first-time setup again.
6. The first successful open encrypts the database and applies schema migrations 27 through 33 (customer credit, grocery bill lines, menu diet, kitchen notes, discount amount). No manual SQL.

If activation cannot be finished in this visit, close the app and leave 0.7.0 unopened against the database. You can reinstall the 0.6.0 exe from the USB or the GitHub release; the plaintext file is unchanged until a licensed launch.

### 8. Smoke test

- [ ] Login works with the existing admin
- [ ] Settings → License shows the license id, Perpetual, and the restaurant name
- [ ] Old bills are still in History and Reports
- [ ] Open a table, add an item, add a kitchen note, send a KOT, and confirm the note prints
- [ ] Print Bill does not mark the order paid
- [ ] Pay with the method they use most, and confirm the table clears
- [ ] If they use percent or fixed discounts, or customer credit, run one of each on the test order before voiding or paying it
- [ ] A Captain phone can still open the floor. Re-pair only if that phone fails
- [ ] The usual bill printer and KOT printer still print
- [ ] `%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite.key` exists
- [ ] Do not delete that `.key` file, `license\`, or `Local State`

### 9. Publish the signed manifest only after the smoke test

Copy the signed desktop manifest over `manifest.json` in the repo. Commit and push to `main`.

```powershell
Invoke-WebRequest -Uri "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.7.0/RestoNiti.Setup.0.7.0.exe" -Method Head
Invoke-WebRequest -Uri "https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.6.0/RestoNiti.Setup.0.6.0.exe" -Method Head
```

Both must return status 200.

Restart RestoNiti on the restaurant PC. Settings → Update & Support → **Check for Updates** should report that 0.7.0 is current. It must not offer another install. If it says the manifest signature is invalid, the signing key does not match the exe you installed. Re-sign with the matching key and push again. Do not generate a new update key after this exe is installed.

`POS_UPDATE_MANIFEST_URL` should already be the machine-wide value below. Set it only if it is missing, then restart the app:

```powershell
[System.Environment]::SetEnvironmentVariable(
    "POS_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json",
    "Machine"
)
```

### 10. Write down the release

| Field | Value |
|---|---|
| Version | `0.7.0` |
| Installed from | USB hand install, not the in-app updater |
| Previous installer | `v0.6.0` |
| Release commit | `git rev-parse v0.7.0` |
| GitHub release | `https://github.com/rashmitasalian/restaurant-pos/releases/tag/v0.7.0` |
| SHA256 (0.7.0) | |
| SHA256 (0.6.0 rollback) | |
| License id | |
| Database copy location | |
| Deployed by | |
| Deployed at | |
| Smoke test | |

---

## Rollback

Use this only if 0.7.0 cannot bill. Rollback returns to the plaintext database from step 6. Orders and payments taken after that copy are lost.

0.6.0 cannot read the encrypted database. Restoring the installer without restoring the plaintext file leaves the POS unable to open.

1. Close RestoNiti completely.
2. Replace `%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite` with the USB copy from step 6.
3. Delete `restaurant-pos.sqlite-wal` and `restaurant-pos.sqlite-shm` if they exist.
4. Leave `restaurant-pos.sqlite.key` and the `license` folder. 0.6.0 ignores them.
5. Run the 0.6.0 installer (`archive\RestoNiti Setup 0.6.0.exe` or the `v0.6.0` GitHub asset).
6. Start RestoNiti, log in, and confirm the last pre-upgrade bill is in History.

Do not restore a backup taken by 0.7.0 after encryption and then expect 0.6.0 to open it.

---

## Already licensed

If this PC already imported a `.rnlc` and Settings → License is populated, the database is already encrypted. Do not hand-copy the sqlite file and do not treat 0.6.0 as a usable rollback of the data file.

Use **Later releases** below. Rollback is one generation, and only the plaintext or encrypted snapshot that this app saved as `pre-update.sqlite` during **Prepare Update**.

---

## Later releases

After this PC is licensed, the next versions can go through Settings → Update & Support. The license stays in `%APPDATA%\Restaurant POS`.

### Prepare

```powershell
git status --short --branch
npm run lint
npm test -- --runInBand
npm version <NEW_VERSION> --no-git-tag-version
npm run build
Get-FileHash "release\RestoNiti Setup <NEW_VERSION>.exe" -Algorithm SHA256 | Select-Object Hash
(Get-Item "release\RestoNiti Setup <NEW_VERSION>.exe").Length
```

Commit the version bump, tag `v<NEW_VERSION>`, push the tag, and upload the exe to that GitHub Release. Keep the previous release’s exe. That previous exe is the rollback installer.

### Manifest

Update `manifest.json`:

- `version`, `installerUrl`, `sha256`, `installerSizeBytes` → the new installer
- `rollbackInstallerUrl`, `rollbackSha256`, `rollbackInstallerSizeBytes` → the previous installer
- `notes` → what changed

Remove any old `signature` before signing. Then:

```powershell
npm run update:sign -- --manifest .\manifest.json
git add manifest.json package.json package-lock.json
git commit -m "chore: publish <NEW_VERSION> update manifest"
git push origin main
```

### On the POS

Quiet period. Admin login. Settings → Update & Support.

1. **Check for Updates** shows the new version and notes.
2. **Prepare Update** backs up the database to `pre-update.sqlite`, then downloads and hashes both installers.
3. **Launch Installer**, confirm the app will close, approve UAC, finish the wizard.
4. Reopen RestoNiti. Expected status is **Update Successful**. Warnings such as a missing printer config are non-critical.
5. Log in, open a table, send a KOT, print a bill, take a payment, and check History.

Record version, tag, both SHA256 values, who deployed, when, and the smoke-test result.

### Rollback from inside the app

Settings → Update & Support → **Roll Back Last Update**. Read the warning. Confirm only if losing orders taken since the update is acceptable. The app restores `pre-update.sqlite`, launches `rollback-installer.exe`, and closes. Finish the installer and restart.

### Rollback when the app will not start

1. Close the POS process.
2. Open `%LOCALAPPDATA%\RestaurantPOS\Updates`.
3. Follow `ROLLBACK-INSTRUCTIONS.txt`.
4. Restore `pre-update.sqlite` onto the live database **before** running `rollback-installer.exe`.
5. Delete the `-wal` and `-shm` files beside the database.
6. Restart RestoNiti.
