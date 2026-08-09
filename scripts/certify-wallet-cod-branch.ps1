param(
  [string]$ProjectRef = 'pflmanpzutisrptudfhd',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ExpectedBranchRef = 'pflmanpzutisrptudfhd'
$ExpectedHash =
  '2ace00e422bc825d6f6d00ac9ccc036b99c0ee5ccc5a4c4b3caa028516a5c98d'
$MigrationName =
  '20260808145400_historical_cod_integrity_and_financial_indexes.sql'

if ($ProjectRef -ne $ExpectedBranchRef) {
  throw "Refusing to target unexpected project ref: $ProjectRef"
}

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$SourceMigration = Join-Path $RepositoryRoot "supabase\migrations\$MigrationName"
$ActualHash =
  (Get-FileHash $SourceMigration -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedHash) {
  throw "Migration hash mismatch: $ActualHash"
}

$WorkRoot = Join-Path $RepositoryRoot '.tmp-wallet-cod-branch'

function Invoke-Supabase {
  param([string[]]$Arguments)
  & npx 'supabase@2.113.0' @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI failed: $($Arguments -join ' ')"
  }
}

if (Test-Path $WorkRoot) {
  Remove-Item -Recurse -Force $WorkRoot
}

try {
  Invoke-Supabase @('init', '--workdir', $WorkRoot, '--yes')
  Invoke-Supabase @(
    'link', '--workdir', $WorkRoot,
    '--project-ref', $ProjectRef, '--yes'
  )
  Invoke-Supabase @(
    'migration', 'fetch', '--workdir', $WorkRoot, '--linked'
  )

  $Destination = Join-Path $WorkRoot "supabase\migrations\$MigrationName"
  if (Test-Path $Destination) {
    throw "Branch already contains migration $MigrationName"
  }
  Copy-Item $SourceMigration $Destination

  Invoke-Supabase @(
    'db', 'push', '--workdir', $WorkRoot,
    '--linked', '--dry-run', '--include-all', '--yes'
  )

  if ($Apply) {
    Invoke-Supabase @(
      'db', 'push', '--workdir', $WorkRoot,
      '--linked', '--include-all', '--yes'
    )
  }
} finally {
  if (Test-Path $WorkRoot) {
    Remove-Item -Recurse -Force $WorkRoot
  }
}
