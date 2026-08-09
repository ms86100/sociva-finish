param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('20260808145400', '20260808150000')]
  [string]$Version,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ProjectRef = 'kkzkuyhgdvyecmxtmkpy'
$Certified = @{
  '20260808145400' = @{
    Name = '20260808145400_historical_cod_integrity_and_financial_indexes.sql'
    Hash = '2ACE00E422BC825D6F6D00AC9CCC036B99C0EE5CCC5A4C4B3CAA028516A5C98D'
  }
  '20260808150000' = @{
    Name = '20260808150000_external_reconciliation_safe_controls.sql'
    Hash = '1456262233BF72903E28EB18B06B0F32D30B3D1483A702C105243D951D4EBAAC'
  }
}

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$Artifact = $Certified[$Version]
$SourceMigration =
  Join-Path $RepositoryRoot "supabase\migrations\$($Artifact.Name)"
$ActualHash =
  (Get-FileHash $SourceMigration -Algorithm SHA256).Hash.ToUpperInvariant()
if ($ActualHash -ne $Artifact.Hash) {
  throw "Certified migration hash mismatch: $ActualHash"
}

$WorkRoot = Join-Path $RepositoryRoot ".tmp-production-$Version"

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

  $Destination =
    Join-Path $WorkRoot "supabase\migrations\$($Artifact.Name)"
  if (Test-Path $Destination) {
    throw "Production already records migration $Version"
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
