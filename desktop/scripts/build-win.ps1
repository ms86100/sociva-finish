# Build Windows NSIS installer and copy into the main Sociva web repo downloads folder.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Desktop = $Root
if ((Split-Path -Leaf $PSScriptRoot) -eq 'scripts') {
  $Desktop = Split-Path -Parent $PSScriptRoot
}
$WebRoot = Join-Path (Split-Path -Parent $Desktop) 'sociva-v1-main\sociva-v1-main'
$Downloads = Join-Path $WebRoot 'public\downloads'

Set-Location $Desktop
Write-Host "Desktop project: $Desktop"
Write-Host "Web downloads:   $Downloads"

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

if (-not (Test-Path (Join-Path $Desktop 'node_modules'))) {
  npm install --legacy-peer-deps
}

npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "dist:win failed" }

$pkg = Get-Content (Join-Path $Desktop 'package.json') -Raw | ConvertFrom-Json
$ver = $pkg.version
$built = Join-Path $Desktop "dist\Sociva-Setup-$ver.exe"
if (-not (Test-Path $built)) {
  $built = Get-ChildItem (Join-Path $Desktop 'dist') -Filter 'Sociva-Setup-*.exe' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $built -or -not (Test-Path $built)) {
  throw "Installer EXE not found under dist/"
}

New-Item -ItemType Directory -Path $Downloads -Force | Out-Null
$stable = Join-Path $Downloads 'sociva-windows-setup.exe'
$versioned = Join-Path $Downloads "sociva-windows-v$ver.exe"
Copy-Item $built $stable -Force
Copy-Item $built $versioned -Force
Write-Host "Copied:"
Write-Host "  $stable"
Write-Host "  $versioned"
Get-Item $stable, $versioned | Format-Table Name, Length, LastWriteTime -AutoSize
