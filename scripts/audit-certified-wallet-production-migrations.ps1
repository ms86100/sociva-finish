param(
  [string]$ProjectRef = 'kkzkuyhgdvyecmxtmkpy'
)

$ErrorActionPreference = 'Stop'
$ExpectedProductionRef = 'kkzkuyhgdvyecmxtmkpy'
if ($ProjectRef -ne $ExpectedProductionRef) {
  throw "Refusing audit for unexpected project ref: $ProjectRef"
}

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$MigrationRoot = Join-Path $RepositoryRoot 'supabase\migrations'
$AuditRoot = Join-Path $RepositoryRoot '.tmp-prod-wallet-migration-audit'

# Excluded because production has differently-versioned migrations with proven
# equivalent catalog outcomes:
# 20260808110000 -> 20260808045911
# 20260808140000 -> 20260808073833
# 20260808141000 -> 20260808074110
# 20260808142000 -> 20260808074219
# 20260808143000 -> 20260808074324
$CertifiedMigrations = [ordered]@{
  '20260807120312_wallet_mvp_sociva_credit.sql' = 'd4d2d7c660f18d15414e5483d6a619a1ab4ab98605ce17e5081a7030e84c2735'
  '20260807120334_wallet_mvp_checkout_settlement.sql' = 'e9c9bcd5f80bd8d35bc612442d5bee10c0327e3e41b3e6ac8583c61554641540'
  '20260808055445_wallet_financial_hardening.sql' = 'ddde05a79eb9b5f5d081a56983cdf08a65c0505aa3a70ef7b2e909ce36532961'
  '20260808062611_wallet_financial_operations.sql' = '3aab3b0e6fd1f903ee93a2522e6537ecd834f57c0c9f3e782301651d5d827b21'
  '20260808130000_emergency_financial_acl_containment.sql' = '00def848228a7de3e09775c92e5ac853c578d765c245f79da97942ddaa9651d6'
  '20260808131000_attempt_aware_payment_truth.sql' = 'df760c2b7872426e6729dad73fcee903597ec864c1d2540075863a3503c8ffe3'
  '20260808132000_cod_and_payout_release_gates.sql' = '8a2692f3c992413d85e4612618941ae83386b6d75b2058c69b6da25e30c3d73f'
  '20260808133000_canonical_runtime_journals.sql' = 'cb0ff8ea835ef69dceede11ddd76610d4f155ffabb74c4ee0c12f00f7b6d7697'
  '20260808134000_external_reconciliation_and_evidence.sql' = '8e4962378ef4a61f6aa00294345691164a940085910bb918f0f2676699471bc9'
  '20260808135000_refund_liability_chargeback_boundaries.sql' = '6492dcec2be411d8c301f31eba8142e941f90a793fc6b276e3c8779d5541fbcc'
  '20260808144000_financial_runtime_preflight.sql' = '15002834860736efa189cecea2d0c86cbcd5c67bbc252f01eaf4b56df55c18cc'
  '20260808145000_financial_acl_runtime_followup.sql' = '34d220bae8605e698b9b1f5b561231c83a105bd9b0dd89e244b92cc68ad34d96'
  '20260808145100_finance_ledger_rls_defense.sql' = 'ea87ab47b327035cb7d5e5c96f0cad2090e7a6ded10eb369f975bf0ae7052c88'
  '20260808145200_wallet_rpc_kill_switch_enforcement.sql' = '49f3280d8037f0b7c2f30eda1e22079b7f3249259c8d29e6f1f098ffcbba900d'
  '20260808145300_financial_capability_enablement_gates.sql' = 'dbcf078471e49020bf45c61c07dc2f6fcbc9998a8742a624c8cbea1eff6e2b93'
  '20260808145400_historical_cod_integrity_and_financial_indexes.sql' = 'd054842f5dfd0ab01d953eab0adb79e6eec010ad3d544d122d3bc771502d9d7a'
}

function Invoke-Supabase {
  param([string[]]$Arguments)
  & npx 'supabase@2.113.0' @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI failed: $($Arguments -join ' ')"
  }
}

if (Test-Path $AuditRoot) {
  Remove-Item -Recurse -Force $AuditRoot
}

try {
  Invoke-Supabase @('init', '--workdir', $AuditRoot, '--yes')
  Invoke-Supabase @(
    'link', '--workdir', $AuditRoot,
    '--project-ref', $ProjectRef, '--yes'
  )
  Invoke-Supabase @('migration', 'fetch', '--workdir', $AuditRoot, '--linked')

  $AuditMigrationRoot = Join-Path $AuditRoot 'supabase\migrations'
  foreach ($entry in $CertifiedMigrations.GetEnumerator()) {
    $source = Join-Path $MigrationRoot $entry.Key
    $actualHash = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $entry.Value) {
      throw "Hash mismatch for $($entry.Key): $actualHash"
    }

    $destination = Join-Path $AuditMigrationRoot $entry.Key
    if (Test-Path $destination) {
      $remoteHash = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($remoteHash -ne $entry.Value) {
        throw "Production history hash mismatch for $($entry.Key): $remoteHash"
      }
      continue
    }
    Copy-Item $source $destination
  }

  Write-Output 'Running read-only production migration dry-run...'
  Invoke-Supabase @(
    'db', 'push', '--workdir', $AuditRoot,
    '--linked', '--dry-run', '--include-all'
  )
} finally {
  if (Test-Path $AuditRoot) {
    Remove-Item -Recurse -Force $AuditRoot
  }
}
