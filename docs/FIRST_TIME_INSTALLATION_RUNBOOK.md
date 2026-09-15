# First-Time Installation Runbook

Use this runbook when installing RestoNiti on a fresh Windows desktop or a restaurant machine that has never run the app before.

Related docs:

- `docs/PRODUCTION_READINESS.md` — pre-deploy checklist
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` — later version updates (not first install)

---

## 1. Prepare The Production Build

Build the installer on a Windows build machine or developer machine with the same dependency setup every time.

### 1.1 Build Machine Prerequisites

Install:

- Node.js 22.x (or the version required by `package.json` `engines`).
- Visual Studio 2022 Build Tools with:
  - C++ desktop workload;
  - MSVC toolchain;
  - Windows SDK.
- Access to the npm registry used by the project.
- Corporate/root CA trust configured for Node if the network uses TLS inspection.

Do not disable npm TLS verification. Prefer the Windows system CA store:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

### 1.2 Install Dependencies

From the repo root:

```powershell
npm ci
```

If the lockfile is intentionally being refreshed, use:

```powershell
npm install
```

### 1.3 Run Required Checks And Build

From the repo root:

```powershell
npm run lint
npm test -- --runInBand
npm run build:renderer
npm run build:electron:system-ca
```

For a full clean package build:

```powershell
npm run build
```

Expected output (name includes the `package.json` version):

```text
release/
  RestoNiti Setup <version>.exe
  win-unpacked\RestoNiti.exe
```

Example for version `0.6.0`: `release\RestoNiti Setup 0.6.0.exe`.

Do **not** commit `.exe` files to git. Installers are large and belong on GitHub Releases or a secure file share.

### 1.4 Record The Installer SHA256

Before you share or copy the installer, record its hash. You will send this to the client (or use it yourself on site):

```powershell
Get-FileHash "release\RestoNiti Setup 0.6.0.exe" -Algorithm SHA256 | Select-Object Hash
(Get-Item "release\RestoNiti Setup 0.6.0.exe").Length
```

Keep the hash and byte size with the release notes / handoff record.

### 1.5 Sign The Windows Installer (Required For Restaurant Machines)

**Why this matters:** Windows Security and SmartScreen treat unsigned NSIS/Electron installers as untrusted. On a restaurant PC you will often see:

- SmartScreen: **“Windows protected your PC”** / Unknown publisher
- Defender: the `.exe` quarantined as a threat

This is expected for unsigned builds. It is **not** a defect in the POS app. The durable fix is Authenticode signing.

electron-builder signs automatically when credentials are present. Unsigned local builds still succeed (useful for developers), but restaurant delivery should be signed.

On the Windows build machine, **before** `npm run build`:

```powershell
$env:WIN_CSC_LINK = "C:\secure\restoniti-codesign.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<pfx-password>"
```

- `WIN_CSC_LINK` may be a `.pfx` path or the base64 contents of the PFX.
- Never commit the PFX or password to the repo.
- Use an **OV** or **EV** code-signing certificate from a trusted CA, or **Azure Trusted Signing**.
- Update `build.win.publisherName` in `package.json` so it matches the certificate Subject CN exactly.

After the build:

```powershell
npm run verify:win-sign
```

Expected: `Valid` signature on `RestoNiti Setup <version>.exe` and `win-unpacked\RestoNiti.exe` (and helpers such as `elevate.exe` when `signDlls` is enabled).

Until a certificate is configured, every new restaurant install can hit SmartScreen again — use the delivery and unblock steps below carefully.

---

## 2. Deliver The Installer To The Client

### 2.1 Do Not Share The EXE Over Chat Or Email

Do **not** send `RestoNiti Setup <version>.exe` via:

- WhatsApp / Telegram / similar messengers (often strip or block `.exe`)
- Gmail / Outlook attachments (size limits; many servers drop executables)
- Ad-hoc Google Drive / Dropbox links without hash verification (Windows tags downloads with Mark of the Web and SmartScreen is stricter)

Those channels either fail to deliver the file, or make Windows Security more likely to block it.

### 2.2 Preferred Delivery Methods

| Method | When to use | Notes |
| --- | --- | --- |
| **USB stick (on site)** | First restaurant install | Copy from the build machine. Usually avoids Mark of the Web. Best until signing is in place. |
| **GitHub Releases (HTTPS link)** | Remote handoff or when you cannot visit | Upload the installer as a release asset; send the client the **download URL + SHA256**, not the binary in chat. |
| **In-app update later** | After first install | Publish a new release + `manifest.json`; set `POS_UPDATE_MANIFEST_URL`. See `docs/PRODUCTION_UPDATE_RUNBOOK.md`. |

### 2.3 Publish To GitHub Releases (Remote Share)

1. Create a git tag for the version (example `v0.6.0`) and push it.
2. Open GitHub → **Releases** → **Draft a new release** for that tag.
3. Attach `release\RestoNiti Setup <version>.exe` as an asset.
4. Publish the release.
5. Click the uploaded asset and **copy the real download URL** (GitHub often replaces spaces with `.` in URLs).

Example shape:

```text
https://github.com/rashmitasalian/restaurant-pos/releases/download/v0.6.0/RestoNiti.Setup.0.6.0.exe
```

Do not invent the URL by hand — always copy it from the release page.

### 2.4 What To Send The Client

Send a short message with **three things** (not the EXE itself):

1. Download link (GitHub Releases HTTPS URL)
2. SHA256 hash from §1.4
3. Install note about SmartScreen (see §4.1)

**Client message template:**

```text
RestoNiti install package

1) Download (HTTPS only):
   <PASTE_GITHUB_RELEASE_ASSET_URL>

2) Verify the file after download (PowerShell):
   Get-FileHash "$env:USERPROFILE\Downloads\RestoNiti.Setup.0.6.0.exe" -Algorithm SHA256

   Expected SHA256:
   <PASTE_SHA256_FROM_BUILD>

   If the hash does not match, delete the file and download again from the link above.

3) Install:
   - Right-click the installer → Run as administrator
   - If Windows says "Windows protected your PC": More info → Run anyway
   - Approve the UAC prompt
   - Finish the installer and launch RestoNiti

Do not download this EXE from WhatsApp, email, or random cloud shares.
```

Adjust the filename in the `Get-FileHash` command to match the actual downloaded name.

### 2.5 Client Verifies The Download

On the restaurant PC, after download:

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\RestoNiti.Setup.0.6.0.exe" -Algorithm SHA256
```

The hash must match the value you recorded in §1.4. If it does not match, stop and re-download from the official GitHub link.

Optional signature check (after you start signing builds):

```powershell
Get-AuthenticodeSignature -LiteralPath "$env:USERPROFILE\Downloads\RestoNiti.Setup.0.6.0.exe"
```

Signed releases should show `Status: Valid` and your publisher name.

---

## 3. Prepare The Restaurant Desktop

1. Confirm the machine is Windows and has a stable user account for POS operation.
2. Confirm the Windows user can run the POS and that an administrator can approve UAC prompts.
3. Install printer drivers:
   - for USB printers, install the Windows printer and note the exact printer name;
   - for network printers, reserve/static-assign printer IP addresses and confirm port `9100`.
4. Confirm the machine clock/timezone are correct.
5. Confirm there is enough free disk space for the app, SQLite database, backups, and future update cache.
6. Get the installer onto the machine using **USB** or the **GitHub download + SHA256 check** from §2 — not WhatsApp/email.
7. Prefer installing while you are present for the first restaurant, especially while builds are still unsigned.

---

## 4. Configure The Update Manifest URL

Set this once on the restaurant machine so future updates can be discovered without resharing EXEs over chat.

Run PowerShell as Administrator:

```powershell
setx /M POS_UPDATE_MANIFEST_URL "https://updates.example.com/restaurant-pos/manifest.json"
```

Or, if the project publishes `manifest.json` from GitHub:

```powershell
[System.Environment]::SetEnvironmentVariable(
    "POS_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json",
    "Machine"
)
```

Restart Windows, or at minimum sign out and sign back in, so the installed app receives the new system environment variable.

If the update URL changes later, run the same command again with the new URL.

---

## 5. Install The App

1. Run the installer, for example:

```text
RestoNiti Setup 0.6.0.exe
```

2. Approve the Windows UAC prompt.
3. Choose the install location if prompted.
4. Finish the installer.
5. Launch **RestoNiti**.

The installer is configured as NSIS `perMachine: true`, so admin permission is expected. Default install location is typically under `C:\Program Files\RestoNiti\`.

### 5.1 If Windows Security Blocks The Installer

Unsigned (or newly signed, low-reputation) Electron/NSIS installers commonly trigger Windows Security. This section is the first-install playbook while signing is incomplete or reputation is still building.

**Typical prompts:**

- SmartScreen: **“Windows protected your PC”** / Unknown publisher
- Defender: file quarantined / removed as a threat

**Steps on a machine you control** (only for a file you built or verified by SHA256):

1. Confirm the file source (USB from your build PC, or GitHub Releases URL you published).
2. Confirm SHA256 matches §1.4.
3. Unblock Mark of the Web if Windows tagged the download:

```powershell
Unblock-File -LiteralPath "$env:USERPROFILE\Downloads\RestoNiti.Setup.0.6.0.exe"
Get-AuthenticodeSignature -LiteralPath "$env:USERPROFILE\Downloads\RestoNiti.Setup.0.6.0.exe"
```

Or from the repo release folder:

```powershell
npm run verify:win-sign
# or with unblock:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-windows-signature.ps1 -Unblock
```

4. SmartScreen: click **More info** → **Run anyway**, then approve UAC.
5. If Defender already quarantined it: **Windows Security → Protection history → restore** the file. Do **not** add a permanent Defender exclusion unless you verified the SHA256 of that exact build.
6. Do **not** tell the restaurant to turn Defender off permanently.

**Production fix (repeat for every release):** Authenticode-sign every `release/*.exe` (and packaged `RestoNiti.exe`) per §1.5. After signing, `Get-AuthenticodeSignature` must report `Valid`.

---

## 6. First Application Run

On first run, the app creates its local SQLite database under Electron `userData`.

Exact folder naming can vary with Electron/product metadata. The database is always under:

```text
<Electron userData>\data\restaurant-pos.sqlite
```

On Windows this is commonly under `%LOCALAPPDATA%\RestoNiti\...` or a related app-data path. Confirm from Settings / app info after install if you need the exact path for backups.

Complete first-run setup:

1. Create the first admin user.
2. Log in as admin.
3. Create at least one cashier user.
4. Configure business identity:
   - restaurant name;
   - initials;
   - phone;
   - email;
   - tagline.
5. Configure GST/business registration if required.
6. Configure table count.
7. Configure printer settings:
   - kitchen printer IP or Windows printer name;
   - counter printer IP or Windows printer name;
   - printer port, usually `9100` for network printers.
8. Send a kitchen test print.
9. Send a counter test print.
10. Create a SQLite backup from Settings.

### Printer setup — Step-by-step (UI)

Follow these exact UI steps during first-run to configure one USB (Windows) printer and one LAN printer.

1. Open the app and sign in as the admin user.
2. Open Settings (click the gear icon in the top-right or use the left navigation → Settings).
3. Choose the **Printers** tab/section.
4. Configure the Kitchen printer (typically used for KOT):
   - If the kitchen printer is a network (LAN) printer, enter its IPv4 address in the **Kitchen Printer** field (example: `192.168.1.45`).
   - If the kitchen printer is a USB/Windows-installed printer, enter the exact Windows printer queue name (example: `EPSON TM-T20II`).
5. Configure the Counter printer (receipt) similarly in the **Counter Printer** field:
   - Example LAN value: `192.168.1.50`
   - Example Windows name: `POS-80C`
6. Set the **Printer Port** field (network printers): `9100` (default). If you enter a Windows printer name, the port value is ignored for that transport.
7. Click **Save**.
8. Use the **Test Print** button for each configured printer:
   - Click **Test Print (Kitchen)** — expected: KOT paper advance or small ESC/POS receipt; the app shows a success message.
   - Click **Test Print (Counter)** — expected: receipt printed; app shows success.
9. If a Test Print fails, try these quick checks:
   - For USB printers: confirm the printer appears in Windows Devices & Printers with the exact queue name; run PowerShell to list printers:

```powershell
Get-Printer | Select-Object -ExpandProperty Name
```

   - For LAN printers: verify you can reach the printer from the POS machine (replace IP as needed):

```powershell
Test-NetConnection -ComputerName 192.168.1.45 -Port 9100
```

   - Ensure Windows Firewall does not block outbound TCP to port `9100` for the POS user.
   - If USB printing fails, confirm `powershell.exe` is available and the POS process can run the Winspool helper (the app uses a PowerShell helper to call `WritePrinter`).
   - If hostname was entered instead of IPv4 and the network path is intended, use the IPv4 address (the app treats only strict IPv4 strings as network printers).
10. After successful test prints, create a local backup from Settings → Backup.

Example values summary:

- Kitchen (LAN): `192.168.1.45`, Port `9100`
- Counter (USB): `EPSON TM-T20II`

---

## 7. First-Time Smoke Test

Before handing the POS to the restaurant:

1. Log in as admin.
2. Create a dine-in order.
3. Send KOT.
4. Complete payment.
5. Print receipt.
6. Create a takeaway order.
7. Attach customer phone.
8. Send KOT.
9. Complete payment.
10. Verify reports/history show the paid orders.
11. Restart the app.
12. Verify login, settings, orders, history, and print configuration persist.

---

## 8. Handoff Record

Record:

- installed app version;
- installer file name and delivery method (USB / GitHub Releases URL);
- installer SHA256;
- whether the build was Authenticode-signed (`Valid` / `NotSigned`);
- admin account owner;
- printer names/IPs;
- update manifest URL (`POS_UPDATE_MANIFEST_URL`);
- backup location/procedure;
- any Windows Security / SmartScreen override used during install.

---

## Quick Reference — First Install Checklist

1. Build on a Windows machine (`npm run build`).
2. Record SHA256 (`Get-FileHash ... -Algorithm SHA256`).
3. Sign if credentials are available (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`, then `npm run verify:win-sign`).
4. Deliver via **USB** or **GitHub Releases link + hash** — never WhatsApp/email EXE.
5. On the restaurant PC: verify hash → Unblock-File if needed → Run as admin → More info → Run anyway if SmartScreen appears.
6. Set `POS_UPDATE_MANIFEST_URL` once.
7. Complete first-run setup, printers, smoke test, and handoff record.
