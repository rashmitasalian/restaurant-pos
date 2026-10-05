# First-time installation runbook

Install RestoNiti on a Windows PC that has never run the app.

Related:

- `docs/PRODUCTION_READINESS.md` — pre-deploy checklist
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` — later updates (not first install)

---

## Quick path

| Who | Do this |
| --- | --- |
| **Builder** | Build → hash → sign (if cert) → publish USB or GitHub Release |
| **On site** | Verify PC → install → first-run setup → smoke test → handoff note |

---

## 1. Client PC requirements

Confirm **before** scheduling install.

| | Minimum | Recommended |
| --- | --- | --- |
| OS | Windows 10/11 **64-bit** (not S mode) | Same |
| CPU | Dual-core x64 ~2 GHz | Quad-core |
| RAM | 8 GB | 16 GB (Captain + reports) |
| Disk | SSD, **20 GB free** | 40 GB+ free |
| Screen | 1366×768 | 1080p |
| Network | Stable LAN/Wi‑Fi if using Captain or LAN printers | Wired preferred |
| Printers | ESC/POS USB or LAN **port 9100** | — |
| Power | Wall power | UPS during service |

**Not supported:** Windows 7/8/8.1, 32-bit, macOS/Linux for this installer path.

**Copy/paste for the client:**

```text
RestoNiti needs:
- Windows 10 or 11, 64-bit (not S mode)
- 8 GB RAM (16 GB better)
- SSD with 20 GB free (40 GB better)
- Screen 1366x768 or larger
- USB/LAN for thermal printers
- Stable Wi-Fi/LAN if using Captain phones

Internet is not required for daily billing after install.
```

---

## 2. Build the installer (dev machine)

### Prerequisites

- Node.js matching `package.json` → `engines` (currently **24.x**)
- Visual Studio 2022 Build Tools (C++ desktop, MSVC, Windows SDK)
- Working npm registry / system CA trust if TLS inspection is used:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

### Build

```powershell
npm ci
npm run lint
npm test -- --runInBand
npm run build
```

Output:

```text
release\RestoNiti Setup <version>.exe
release\win-unpacked\RestoNiti.exe
```

Do **not** commit `.exe` files to git.

### Hash

```powershell
Get-FileHash "release\RestoNiti Setup 0.6.0.exe" -Algorithm SHA256
```

Save the SHA256 with the release notes. Replace the version with yours.

### Sign (restaurants)

Unsigned builds often trip SmartScreen. For restaurant delivery, set cert env vars **before** build:

```powershell
$env:WIN_CSC_LINK = "C:\secure\restoniti-codesign.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<pfx-password>"
npm run build
npm run verify:win-sign
```

- Never commit the PFX or password.
- `build.win.signtoolOptions.publisherName` in `package.json` must match the cert Subject CN.
- Expect `Valid` on the setup EXE and `win-unpacked\RestoNiti.exe`.

### License key (once per vendor machine)

The installer is the same for every restaurant. Each PC is unlocked with a signed `.rnlc` file. The private key stays on your machine, outside this repo:

```text
%USERPROFILE%\.restoniti\license-ed25519.pem
%USERPROFILE%\.restoniti\license-ledger.jsonl
```

```powershell
npm run license:keygen
```

`electron/licensing/publicKey.ts` already contains the matching public key. If keygen says the private key does not match, do not issue licenses.

Do not commit the private key, the ledger, or `.rnlc` files.

---

## 3. Deliver the installer

| Do | Don’t |
| --- | --- |
| USB from your build PC (best for first visit) | WhatsApp / Telegram EXE |
| GitHub Releases HTTPS link + SHA256 | Email EXE attachment |
| | Random Drive/Dropbox links without hash check |

### GitHub Releases (remote)

1. Tag + push (e.g. `v0.6.0`)
2. Draft release → attach `RestoNiti Setup <version>.exe`
3. Copy the **asset download URL** from the release page (don’t invent it)

### Message to send the client

```text
RestoNiti install

1) Download:
   <GITHUB_ASSET_URL>

2) Verify (PowerShell):
   Get-FileHash "$env:USERPROFILE\Downloads\<downloaded-filename>" -Algorithm SHA256

   Expected SHA256:
   <HASH_FROM_BUILD>

3) Install:
   - Right-click installer → Run as administrator
   - If "Windows protected your PC" → More info → Run anyway
   - Approve UAC → finish → open RestoNiti

Do not install an EXE from chat or email.
```

---

## 4. On-site install

### Before you click the installer

1. PC meets §1 (64-bit, RAM, free disk).
2. Clock/timezone correct.
3. Printer drivers installed; note **exact** Windows printer names or static printer IPs.
4. Installer arrived via USB or GitHub + matching SHA256.
5. Admin available for UAC.

### Optional: update URL (once)

So later updates don’t need another USB handoff:

```powershell
# Run PowerShell as Administrator
setx /M POS_UPDATE_MANIFEST_URL "https://raw.githubusercontent.com/rashmitasalian/restaurant-pos/main/manifest.json"
```

Sign out/in (or reboot) so the app sees the variable. Details: `docs/PRODUCTION_UPDATE_RUNBOOK.md`.

### Install

1. Run `RestoNiti Setup <version>.exe` as administrator.
2. Approve UAC → finish → launch **RestoNiti**.
3. Default location: `C:\Program Files\RestoNiti\`.

### Activate this PC

The first launch must be the Windows account that will run RestoNiti every day. A different Windows login cannot read the installation identity.

1. Open RestoNiti. If this PC is not licensed, it shows **Installation Code** and does not open the POS. Captain does not start.
2. Copy the full code and send it to RestoNiti. Internet is not required on the restaurant PC.
3. On the vendor machine, issue a perpetual license. Paste the full code. Do not shorten it.

```powershell
npm run license:issue -- --customer "Restaurant Name" --code "RN1-...." --out "$env:USERPROFILE\Desktop\Restaurant-Name.rnlc"
npm run license:verify -- --file "$env:USERPROFILE\Desktop\Restaurant-Name.rnlc"
```

4. On the restaurant PC, choose that `.rnlc` file. After it verifies, first-admin setup continues.
5. The license is stored at `%APPDATA%\Restaurant POS\license\license.rnlc`. It is not inside the SQLite database and is not part of a database backup.

Everything RestoNiti keeps for that Windows user is in `%APPDATA%\Restaurant POS`: the database, the license, the installation identity, and Chromium's `Local State` file. `Local State` holds the key that unlocks the installation identity. Do not delete or "clean up" any file in that folder. An old `%APPDATA%\restaurant-pos` folder from earlier builds only holds caches and can be left alone.

Only one RestoNiti window runs at a time. Opening it again brings the running window to the front.

A normal reinstall that leaves `%APPDATA%\Restaurant POS\license\` in place stays licensed. A Windows reinstall, a different Windows user, a deleted identity file, or a wiped AppData folder needs a replacement license. Ask for the new installation code and issue a new file with `--replaces` set to the old license id, so the ledger marks the old one replaced:

```powershell
npm run license:issue -- --customer "Restaurant Name" --code "RN1-...." --replaces RN-2026-000001 --out "$env:USERPROFILE\Desktop\Restaurant-Name.rnlc"
```

The issuer warns if the restaurant name already has an active license and you did not pass `--replaces`, or if that installation code was already issued. A second restaurant with the same name is allowed; read the warning and continue. The old PC is not remotely disabled. A damaged identity file is a support case: do not delete it unless you are ready to issue a new license.

### Restaurant that already runs RestoNiti

This is a one-time unlock for that PC, not a renewal. A site that already bills on an older build has no license file yet. Their menu, bills, and users stay in `%APPDATA%\Restaurant POS`. Do not install this build during service unless you can import the license in the same visit. Until the `.rnlc` is imported, that PC cannot open the POS or Captain.

Do not ship the first licensed build to an existing site through the update manifest or the in-app updater. An automatic update would restart them into the activation screen with no license ready, and they could not bill until you respond. Install it on site, or on a phone or remote call where you issue the `.rnlc` straight away. Once the PC is licensed, later updates through the manifest are fine because the license stays in AppData.

1. Install the new setup exe over the current one. Program files change. The existing database does not.
2. Open RestoNiti with the Windows account they use every day. The activation screen shows the installation code. The database is not opened yet.
3. Copy the full code and issue the license on your machine (same commands as above). Use the restaurant’s real name in `--customer`.
4. On their PC, choose that `.rnlc` file.

They then log in with the admin account they already have. They do not repeat first-time setup. After that, the license stays valid with no internet and no renewal. Settings → License shows the license id, Perpetual, and the restaurant name.

A later reinstall that keeps `%APPDATA%\Restaurant POS\license\` does not need a new file.

### If Windows blocks it

Only for a file **you** built or whose SHA256 you verified:

1. Unblock download mark if needed:

```powershell
Unblock-File -LiteralPath "$env:USERPROFILE\Downloads\<installer>.exe"
```

2. SmartScreen → **More info** → **Run anyway** → UAC.
3. If Defender quarantined it → Protection history → restore that file (do not turn Defender off).
4. Long-term fix: sign every release (§2).

---

## 5. First run setup

Database is created under Electron userData:

```text
%APPDATA%\Restaurant POS\data\restaurant-pos.sqlite
```

### Configure once

1. Create first **admin** → log in.
2. Create at least one **cashier**.
3. Settings → branding (name, initials, phone, email, tagline).
4. GST / registration if needed.
5. Tables / floor layout.
6. **Printers:**
   - Kitchen / Counter: IPv4 (e.g. `192.168.1.45`) **or** exact Windows printer name.
   - Port `9100` for LAN printers (ignored for USB/Windows names).
   - Save → **Test Print** kitchen and counter.
7. Settings → create a **local backup**.

**Printer troubleshooting**

```powershell
Get-Printer | Select-Object -ExpandProperty Name
Test-NetConnection -ComputerName 192.168.1.45 -Port 9100
```

Use IPv4 for LAN printers (not hostnames).

---

## 6. Smoke test (before handoff)

- [ ] Admin login
- [ ] Dine-in order → Send KOT → pay → receipt
- [ ] Takeaway + customer phone → KOT → pay
- [ ] History/reports show both orders
- [ ] Restart app → login, settings, printers still OK

Captain (optional): same Wi‑Fi as the POS. On the POS header, open the Gateway chip (**Captain phones**) and scan the QR, or open `http://<POS-LAN-IP>:4747` and enter the pairing code shown there.

---

## 7. Handoff record

Write down:

- App version  
- Windows edition (64-bit) / RAM / free disk  
- Installer name + USB or GitHub URL  
- SHA256  
- Signed? (`Valid` / `NotSigned`)  
- Admin owner  
- Printer names/IPs  
- `POS_UPDATE_MANIFEST_URL` (if set)  
- Backup location  
- Any SmartScreen override used  

---

## Checklist

**Build**

- [ ] `npm run build` succeeds  
- [ ] SHA256 recorded  
- [ ] Signed + `npm run verify:win-sign` (restaurants)  
- [ ] Delivered via USB or GitHub link + hash  

**Site**

- [ ] PC meets requirements  
- [ ] Hash verified  
- [ ] Installed as admin
- [ ] License imported for this PC (installation code issued on the vendor machine)
- [ ] Existing site: same Windows account, license imported before leaving, old login still works
- [ ] Existing site: first licensed build installed by hand, not through the update manifest
- [ ] Admin + cashier + branding + printers + backup
- [ ] Smoke test passed  
- [ ] Handoff record saved  
