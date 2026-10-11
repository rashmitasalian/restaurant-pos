# Production Update Runbook

**Repo:** `https://github.com/rashmitasalian/restaurant-pos`  
**Last updated:** 2026-10-11

Use this runbook for every release after a restaurant PC is on licensed **0.7.0** or newer. The one-time 0.6.0 to 0.7.0 visit, including license activation and database encryption, is `docs/UPDATE_0_6_0_TO_0_7_0.md`.

A new PC uses `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md`.

---

## How an update works

The installed `.exe` version comes from `package.json` at build time. Settings → **Update & Support** compares that version with the `version` field in `manifest.json` at `POS_UPDATE_MANIFEST_URL`. A higher manifest version is offered. Git tags exist so GitHub Releases can host the installer.

The live manifest URL is:

```text
https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json
```

From 0.7.0 onward, Check for Updates rejects a manifest that has no valid Ed25519 `signature`. The license stays in `%APPDATA%\Restaurant POS` and is not reissued for an update.

Settings shows the version of the installed exe. A development session started from `electron/main-dev.cjs` shows the Electron version instead, so confirm the restaurant PC from the installed app.

---

## Before you publish

### 1. Confirm the update key matches this source tree

```text
%USERPROFILE%\.restoniti\update-ed25519.pem
```

```powershell
cd "C:\Users\rashm\Documents\RestoNiti\restaurant-pos"
npm run update:keygen
```

The command must say the existing key **matches** the public key in `electron/licensing/publicKey.ts`. If it creates a new key, that public key is not in the exe already installed at the restaurant. Paste it into `UPDATE_PUBLIC_KEY_BASE64` and ship that build before you sign a manifest with the new key.

Do not commit the private key.

### 2. Build the new version

Node.js **24.x** (see `package.json` `engines`). Visual Studio 2022 Build Tools with the C++ workload, MSVC, and the Windows SDK.

Replace `<NEW_VERSION>` in every command below. It must be higher than the version installed at the restaurant.

```powershell
git status --short --branch
npm ci
npm run lint
npm test -- --runInBand
npm version <NEW_VERSION> --no-git-tag-version
npm run build
```

On a network that intercepts TLS:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run build
```

Built file:

```text
release\RestoNiti Setup <NEW_VERSION>.exe
```

Skip `WIN_CSC_LINK` unless you have a code-signing certificate. An unsigned installer needs **More info** → **Run anyway** on the restaurant PC. Do not rebuild after that choice.

### 3. Retrieve the installer hashes and sizes

You need four numbers: hash and size of the new installer, and hash and size of the installer the restaurant is running now. That current installer becomes the rollback. Do not look in `archive\`. That folder is gitignored and is usually empty.

**New installer.**

```powershell
$new = Get-Item "release\RestoNiti Setup <NEW_VERSION>.exe"
Get-FileHash $new.FullName -Algorithm SHA256 | Select-Object Hash
$new.Length
```

`Hash` is `sha256`. `Length` is `installerSizeBytes`.

**Rollback installer.** Read the manifest that is live on `main`. Its `sha256` and `installerSizeBytes` describe the installer the restaurant can already download. Copy those two fields into the new manifest as `rollbackSha256` and `rollbackInstallerSizeBytes`. Copy `installerUrl` into `rollbackInstallerUrl`.

```powershell
$live = Invoke-RestMethod "https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json"
$live | Select-Object version, sha256, installerSizeBytes, installerUrl
```

Use `sha256` and `installerSizeBytes` from that output. Leave `rollbackSha256` and `rollbackInstallerSizeBytes` behind. Those belong to the installer before the one on the restaurant PC. After this release is published, its `sha256` and `installerSizeBytes` become the rollback values for the release after that.

To confirm the GitHub file matches the published hash, download it and hash it:

```powershell
$out = Join-Path $env:TEMP "RestoNiti-rollback.exe"
Invoke-WebRequest -Uri $live.installerUrl -OutFile $out
Get-FileHash $out -Algorithm SHA256 | Select-Object Hash
(Get-Item $out).Length
```

The hash and length must match `$live.sha256` and `$live.installerSizeBytes`. If they do not, stop. The restaurant is not running the file described in the live manifest.

### 4. Tag and publish the installer

```powershell
git add package.json package-lock.json
git commit -m "chore: bump version to <NEW_VERSION>"
git push origin main
git tag v<NEW_VERSION>
git push origin v<NEW_VERSION>
```

Create the GitHub Release for tag `v<NEW_VERSION>`. Attach `release\RestoNiti Setup <NEW_VERSION>.exe`. Do not commit the exe. Copy the asset URL from the release page. GitHub turns spaces into dots, so the URL looks like `RestoNiti.Setup.<NEW_VERSION>.exe`.

Leave `manifest.json` on `main` unchanged until the release asset is downloadable.

### 5. Write the manifest, then sign it

`npm run update:sign` only signs a file that already exists. It does not create one.

Edit `manifest.json` in the repo. Remove any existing `signature` first. Paste the four numbers from step 3. Hash case does not matter; the app compares hashes in lowercase.

| Field | Where the value comes from |
| --- | --- |
| `version` | `<NEW_VERSION>` |
| `installerUrl` | Asset URL copied from the new GitHub Release |
| `sha256` | `Hash` of the new exe |
| `installerSizeBytes` | `Length` of the new exe |
| `rollbackInstallerUrl` | `installerUrl` from the live manifest |
| `rollbackSha256` | `sha256` from the live manifest |
| `rollbackInstallerSizeBytes` | `installerSizeBytes` from the live manifest |
| `notes` | What changed in this release |

```powershell
npm run update:sign -- --manifest .\manifest.json
git add manifest.json package.json package-lock.json
git commit -m "chore: publish <NEW_VERSION> update manifest"
git push origin main
```

`manifest.json` must contain a `signature` field before that push. Confirm both installer URLs return status 200:

```powershell
Invoke-WebRequest -Uri "<new installerUrl>" -Method Head
Invoke-WebRequest -Uri "<rollbackInstallerUrl>" -Method Head
```

---

## On the restaurant PC

Do this after close, or with no open orders. An admin logs in. Settings → **Update & Support**.

If **Check for Updates** says the manifest URL is not configured, set it once in an Administrator PowerShell window, then restart the app:

```powershell
[System.Environment]::SetEnvironmentVariable(
    "POS_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json",
    "Machine"
)
```

Then:

1. **Check for Updates** shows the new version and notes.
2. **Prepare Update** backs up the database to `pre-update.sqlite`, then downloads and hashes both installers.
3. **Launch Installer**, confirm the app will close, approve UAC, and finish the wizard.
4. Reopen RestoNiti. Expected status is **Update Successful**. Warnings such as a missing printer config are non-critical.
5. Log in, open a table, send a KOT, print a bill, take a payment, and check History.

If Check for Updates says the manifest signature is invalid, the signing key does not match the installed exe. Re-sign with the key that matches that exe. Do not generate a new update key after the exe is installed.

Record the version, tag, both SHA256 values, who deployed, when, and the smoke-test result.

---

## Rollback from inside the app

Settings → Update & Support → **Roll Back Last Update**. Read the warning. Confirm only if losing orders taken since the update is acceptable. The app restores `pre-update.sqlite`, launches `rollback-installer.exe`, and closes. Finish the installer and restart.

Rollback is one generation. It uses the snapshot saved during **Prepare Update**.

---

## Rollback when the app will not start

1. Close the POS process.
2. Open `%LOCALAPPDATA%\RestaurantPOS\Updates`.
3. Follow `ROLLBACK-INSTRUCTIONS.txt`.
4. Restore `pre-update.sqlite` onto the live database **before** running `rollback-installer.exe`.
5. Delete the `-wal` and `-shm` files beside the database.
6. Restart RestoNiti.
