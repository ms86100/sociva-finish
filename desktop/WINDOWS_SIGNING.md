# Windows Authenticode (removes SmartScreen “suspicious download”)

Microsoft shows **“This file isn’t commonly downloaded and may be dangerous”** for **any unsigned `.exe`** with low reputation. That is not a virus in Sociva — it is missing a **code-signing certificate**.

## What customers need

A Windows **Authenticode** certificate, preferably **EV Code Signing** (immediate SmartScreen reputation):

| Provider examples | Type |
|-------------------|------|
| DigiCert, Sectigo, SSL.com, GlobalSign | OV or EV Code Signing |

### After you buy the cert

1. Export as `.p12` / `.pfx` with a password.
2. Base64-encode the file (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("SocivaCodeSign.pfx")) | Set-Clipboard
```

3. In GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|--------|
| `WIN_CSC_LINK` | Base64 of the `.p12`/`.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password for that file |

4. Run workflow **Build Sociva Windows Desktop**.
5. Copy the signed `Sociva-Setup-*.exe` to `public/downloads/sociva-windows-setup.exe` and set `WINDOWS_SETUP_AVAILABLE = true` in `LandingDownload.tsx`.

Until then, the public site **does not offer** the Windows download (so customers never see SmartScreen).

## Working directories (isolation)

| Path | Purpose | Affects iOS/Android? |
|------|---------|----------------------|
| `desktop/` in this repo | Electron shell only | **No** |
| `../sociva-desktop` (sibling folder) | Local copy / scratch | **No** |
| `android/`, `ios/`, Capacitor | Unchanged by desktop packaging | N/A |

Desktop loads `https://www.sociva.in` — it does not modify native mobile projects.
