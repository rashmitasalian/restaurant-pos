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

Database is created under Electron userData, typically:

```text
%LOCALAPPDATA%\RestoNiti\...\data\restaurant-pos.sqlite
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

Captain (optional): same Wi‑Fi as POS; open `http://<POS-LAN-IP>:4747` with pairing code from the Gateway chip.

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
- [ ] Admin + cashier + branding + printers + backup  
- [ ] Smoke test passed  
- [ ] Handoff record saved  
