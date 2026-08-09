# SOCIVA Financial Operations — Implementation Handoff

**Status:** Implemented in repository, disabled by default, not deployed or professionally approved  
**Migrations:** `20260808055445_wallet_financial_hardening.sql`, `20260808062611_wallet_financial_operations.sql`

## Implemented controls

- Platform collect only during Razorpay order creation; seller transfer happens only in the deferred settlement worker.
- Captured-only payment recognition, parent capture plus child allocations, exact refund identity, leased provider-event inbox, and unknown-state reconciliation.
- Private balanced journal in integer paise with typed accounts, templates, immutable posting, reversals, projections, and evidence-only historical candidates.
- Seller-collected COD is stored separately and never credited to online payable.
- Payout claim/finalization is atomic and mutually exclusive with refund initiation.
- Payouts require three independent gates: legacy Route credential flag, `seller_payout_enabled`, and `provider_payout_mode=razorpay_route_deferred`.
- Verified payout destination, cooling period, amount limits, pending-attempt limit, and exact provider-reference recovery.
- Maker-checker approval for enabling money controls and posting manual adjustments.
- Server-authoritative seller summary/activity, admin overview, reconciliation alerts, and one-reference admin financial trace.

## Default no-go controls

The migration leaves ledger read cutover, shadow posting, seller payout, wallet spending/issuance/refund-credit, buyer top-up, buyer withdrawal, buyer P2P, Route order transfer, and COD payable offset disabled. Enabling a financial control requires a maker-checker request; emergency disabling remains possible without approval.

## Required deployment order

1. Back up the database and record migration state.
2. Run both migrations against a disposable production-shaped database.
3. Regenerate Supabase types and run database/RLS/concurrency tests.
4. Deploy payment, refund, webhook, settlement, auto-cancel, and reconciliation functions.
5. Keep all new movement/read-cutover flags disabled.
6. Review historical backfill candidates and opening differences; never auto-post ambiguous history.
7. Run shadow reconciliation through the accounting-approved observation window.
8. Obtain legal, provider, tax, controller, security, and operational approvals.
9. Register verified internal-canary payout destinations and wait through cooling periods.
10. Enable one gate at a time through maker-checker, with reconciliation after each stage.

## Rollback

Disable `seller_payout_enabled`, set `provider_payout_mode=disabled`, and disable wallet issuance/spend first. Do not delete provider events, attempts, captures, journals, COD records, reconciliation exceptions, or obligations. Resolve provider-success/database-failure windows by exact provider reference before any retry.

## Verification completed locally

- Focused payment/wallet/checkout/notification regression suites.
- TypeScript application check.
- Production web build.
- Source contracts for capture, refund, payout, controls, projections, and trace.

Database migration execution, Deno checks, live provider payload evidence, remote deployment, and professional approvals remain mandatory release gates.
