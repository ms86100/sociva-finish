# External reconciliation readiness — 2026-08-08

Scope: production-safe, read-only inspection of the deployed Supabase schema,
configuration, worker source, and aggregate evidence. No provider was contacted,
no production row was changed, and no money-movement capability was enabled.

## Current verdict

The deployed database is technically ready for reconciliation and all observed
money-movement gates are disabled. `reconciliation_read_enabled` is also
disabled. Keep it disabled: the deployed `reconcile-financials` worker is not a
pure read operation. It performs provider GET requests, then upserts
`provider_statement_rows` and invokes two database functions that write
reconciliation records, matches, and exception rows.

Configured Razorpay key metadata exists in `admin_settings` for
`razorpay_key_id`, `razorpay_key_secret`, and `razorpay_webhook_secret`.
This proves only that non-empty configured values exist. It does not prove that
the key is live, read-scoped, permitted to list payments/refunds/transfers/
settlements, or associated with the intended Razorpay account. No relevant
Vault secret names were present; the deployed fallback is `admin_settings`.
Those claims require an explicitly approved provider read and must not be
inferred from configuration metadata.

Production currently contains no imported provider rows, bank rows, statement
imports, reconciliation matches, reconciliation records, opening-balance
requests, or reconciliation exceptions. The canonical provider-linked source
tables also contain no payment captures, refund attempts, payout attempts, or
provider IDs. Two seller-settlement rows exist, but they are not provider or
bank statement evidence.

## Deployed controls observed

- `financial_runtime_preflight()` reports schema/payment/payout/refund/
  reconciliation/recovery readiness and `money_movement_disabled = true`.
- Every observed movement capability is false, including payment create,
  payment confirm, webhook capture/refund mutation, refund processing, payout,
  Route transfer, recovery mutation, wallet movement, and COD offset.
- `provider_payout_mode = disabled`.
- Reconciliation tables have RLS enabled. Client roles have no CRUD privilege
  on statement staging/match tables.
- `public.reconcile_external_statements(date)` is service-role-only.
- The reconciliation Edge Function is deployed and active, but no reconciliation
  cron job is registered.

## Blocking design gaps

1. **The “read” gate protects a write pipeline.** Enabling
   `reconciliation_read_enabled` authorizes provider reads and production
   staging/reconciliation writes in one invocation. There is no fetch-only,
   persist-disabled probe mode.
2. **No import envelope is written.** The worker never inserts
   `financial_statement_imports`, never records source checksum/status/row
   count, and never assigns `provider_statement_rows.import_id`. This prevents
   complete file/API-run lineage and clean replay accounting.
3. **No bank ingestion workflow exists.** The schema accepts bank rows, but no
   parser, account allowlist, opening/closing balance proof, checksum manifest,
   maker/checker import flow, or bank-source adapter is deployed.
4. **Credential capability is unproved.** Configured values are not evidence of
   provider account identity, endpoint permissions, environment (test/live), or
   read-only scope. The same key pair is used for all four resources, including
   Route transfers.
5. **No clean shadow-parity evidence exists.** There are zero external rows and
   zero completed import/reconciliation runs.
6. **Exception operations are incomplete.** The queue has owner/status/
   acknowledgement/escalation timestamps and retry counters, but lacks
   assignment time, acknowledger identity, append-only acknowledgement and
   escalation events, SLA policy/version, notification receipt, and durable
   dead-letter payload/replay history.
7. **Variance aging is not modeled as evidence.** `first_seen_at` can provide a
   current age, but there is no daily snapshot, age bucket, last-seen timestamp,
   disposition history, or signed close reason.
8. **Opening balance can post journals.** Request/approval is maker-checker, but
   production has no requests or bank opening-balance evidence. It must remain
   outside any statement-import trial.
9. **No one-rupee trace exists.** A valid trace means exactly 100 INR minor
   units and must link provider event, internal attempt/capture/allocation,
   journal transaction/entries, settlement, bank credit, reconciliation match,
   and any reversal/refund. Synthetic or unrelated one-unit journal rows do not
   qualify.

## Evidence required for a clean shadow-parity window

Use an agreed immutable window (recommended: at least 14 consecutive settlement
days plus two bank business days) and retain:

- provider account/environment identity and a credential capability attestation;
- per-endpoint request window, pagination completeness, response status, item
  count, retrieval timestamp, and immutable response checksum;
- one import envelope per source/day with parser version, source checksum,
  row count, accepted/rejected counts, and terminal status;
- all payment/refund/transfer/settlement rows with stable fingerprints and
  revision history;
- bank account identity (masked), statement period, opening balance, closing
  balance, debit/credit totals, row count, source checksum, and signer/custodian;
- exact internal/provider/bank match evidence, never date/amount-only matching;
- daily control totals by event type and currency: count, gross, fee, tax,
  refund, transfer, settlement, and bank credit;
- unmatched and mismatched populations with amount variance, first/last seen,
  age bucket, owner, SLA, acknowledgement actor/time, escalation actor/time,
  disposition, resolution evidence, and independent reviewer;
- dead-letter original payload fingerprint, error class, attempts, next retry,
  terminal reason, replay authorization, replay result, and idempotency proof;
- zero unexplained variance at window close, with any accepted timing variance
  carried forward and then proven cleared;
- a real, consented ₹1.00 trace (100 minor units) across every applicable layer,
  with no production movement created solely for testing.

## Safe next actions

1. Build a separate fetch-only Razorpay capability probe on a disposable
   Supabase branch. It must return only endpoint/account metadata and aggregate
   counts, disable persistence, redact identifiers, and have no RPC or mutation
   path.
2. Have the provider/account owner independently authorize that probe and
   confirm the credential is live-account, list-capable, and read-only for each
   required endpoint. Do not test transfers by creating one.
3. Implement provider and bank import envelopes, deterministic checksums,
   parser fixtures, rejected-row/DLQ records, and replay idempotency on the
   disposable branch.
4. Add append-only assignment, acknowledgement, escalation, retry, dead-letter,
   and resolution events before starting a shadow window.
5. Obtain genuine bank statement/opening-balance evidence through the approved
   finance channel; do not infer balances from seller settlements or internal
   ledgers.
6. Run synthetic fixtures only on the disposable branch, then request a
   separately gated production shadow-import approval that explicitly permits
   staging writes while every movement gate remains false.
