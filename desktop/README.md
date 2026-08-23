# Sociva Desktop

Isolated **Electron** shell for Windows and macOS. Lives in this monorepo under `desktop/` so GitHub Actions can build Mac DMGs without touching app business logic.

Loads the live cloud app at `https://www.sociva.in` (same Supabase backend as web/mobile).

## Architecture

```text
Sociva.exe / Sociva.app
        │
        ▼
 https://www.sociva.in
        │
        ▼
  Supabase Cloud
```

## Develop

```bash
cd desktop
npm install
npm start
```

## Build Windows (local)

```powershell
cd desktop
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run dist:win
# then copy dist/Sociva-Setup-*.exe → public/downloads/sociva-windows-setup.exe
```

## Build macOS (GitHub Actions — recommended)

1. Push this repo to GitHub.
2. Actions → **Build Sociva macOS Desktop** → **Run workflow**.
3. When finished, open the new **Release** and download `Sociva-mac.dmg`.
4. Landing page link: `https://github.com/ms86100/sociva-finish/releases/latest/download/Sociva-mac.dmg`

Or tag a stable build:

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

### Optional: Apple signing / notarization (production Gatekeeper)

Add these GitHub **Secrets** when ready (not required for BAT/UAT):

| Secret | Purpose |
|--------|---------|
| `CSC_LINK` | Base64 of Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID |

Until those exist, builds stay **unsigned** (right-click → Open on first launch).

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Never ship `service_role`, Razorpay secrets, or DB passwords in the desktop binary
