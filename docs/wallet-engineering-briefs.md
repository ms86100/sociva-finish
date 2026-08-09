# SOCIVA Money Movement — Revised Engineering Briefs

**Baseline:** [`wallet-phase0-controls.md`](./wallet-phase0-controls.md)  
**Accounting:** [`wallet-accounting-brief.md`](./wallet-accounting-brief.md)  
**Rule:** A later phase cannot weaken an earlier control without written professional approval and a versioned design review.

## Phase 0 — Contain and prove

**Goal:** Freeze funds flow before adding features.

Deliver:

- Remove all order-attached Razorpay `transfers`; payment creation is platform-collect for single- and multi-seller orders.
- Keep seller payout calls exclusively in `process-settlements`, behind `provider_payout_mode=disabled` and `razorpay_route_enabled=false`.
- Make linked account, provider credentials, and an admin toggle individually insufficient to transfer funds.
- Define online seller payable and seller-collected COD as separate subledgers and UI totals.
- Introduce audited, server-side kill switches listed in the Phase 0 controls.
- Remove/deny buyer top-up, transfer, P2P, cashout, withdrawal, and seller withdrawal endpoints.

Exit evidence:

- Captured Razorpay order-request fixtures for single seller, multiple orders, and multiple sellers show no `transfers`.
- A linked seller with both Route credentials and account ID still receives no transfer while either payout switch is off.
- COD completion creates no online seller payable and no payout candidate.
- Counsel/provider/accounting/tax decision records exist; absence means no-go, not implied approval.

## Phase 1 — Restricted SOCIVA Credit stabilization

**Goal:** Keep the shipped buyer-credit MVP restricted, auditable, and reversible.

In scope: eligible refund credit, promo/support credit, reserve/commit/release, checkout application, history, expiry only if approved. Out of scope: buyer-loaded value, bank linking, P2P, cashout, withdrawal, seller wallet.

Required changes/evidence:

- Server computes amounts from authoritative orders and lots; client amount is advisory only.
- Credit issue, reserve, commit, release, restore, expire, and reverse are atomic, balanced, idempotent, and append-only.
- One order/tender allocation records refund-credit versus promo consumption; refunds cannot exceed original tender allocation.
- Credit destination requires explicit consent and policy version; original-method remains the conservative default.
- Cache drift is detected and rebuildable from ledger/lots; expiry preserves held-credit behavior deterministically.
- UI says “SOCIVA Credit” and “usable only on eligible SOCIVA purchases; cannot be added, sent, withdrawn, or redeemed for cash.”

Gate: no negative available balance, duplicate mutation, unbalanced journal, silent refund conversion, or unreconciled liability variance in concurrency and replay tests.

## Phase 2 — Payables, COD, refunds, and operations

**Goal:** Operate platform collect and deferred settlement without describing internal records as custody.

Deliver:

- Seller view separates: estimated earnings, online payable pending, eligible, on hold, paid out, seller-collected COD, COD fees due, refunds/adjustments.
- Eligibility requires paid/verified tender, successful completion/delivery, cooldown elapsed, no refund/dispute/hold, balanced journal, and reconciliation pass.
- Settlement worker claims a row atomically, uses a deterministic provider idempotency key, queries unknown outcomes before retry, and records attempt history.
- Original-method refund, credit refund, partial refund, post-payout recovery, chargeback, and COD refund each have explicit state machines and journal templates.
- Daily provider/bank, seller-payable, credit-liability, and COD-receivable reconciliation produces retained evidence and pages an owner on variance.
- Dual-control workflows cover manual credit, hold release, payout retry, correction, and kill-switch changes.

Gate: shadow reconciliation has zero unexplained variance for an accounting-approved observation period; finance signs the COD aging and seller statement samples.

## Phase 3 — Approved provider-mode switch

**Goal:** Enable one reviewed provider payout mode without enabling a general wallet.

Prerequisites:

- Legal, tax, accounting, security, and provider approvals identify exact API mode, fund flow, refund behavior, seller terms, limits, and rollback.
- Provider contract and sandbox tests confirm platform-collect plus deferred transfer.
- `provider_payout_mode` is an allowlist enum, initially `disabled`; unsupported/unknown values fail closed.
- Canary allowlist limits sellers, amount per transfer/day, batch size, and rollout window.
- Webhook verification, provider API reconciliation, idempotency, timeout/unknown handling, reserves, and incident runbook pass.

Rollout: shadow → internal seller → capped canary → staged cohort → general availability. At every stage, switch off external transfers while preserving eligibility, history, reconciliation, and refunds.

This phase does not authorize buyer top-up, P2P, cashout, or withdrawal. Those require a separate regulated-product program.

## Security boundaries

- Browser/mobile clients can read only their scoped projections; they cannot write wallets, journals, lots, reservations, payout status, provider IDs, or switches.
- Edge functions authenticate the caller and invoke narrowly granted private database routines. Service-role credentials never reach clients, logs, notes, or provider metadata.
- Privileged database functions use fixed `search_path`, explicit ownership/grants, and preferably a non-exposed schema; exposed wrappers contain authorization and no dynamic SQL.
- Provider webhooks verify signature over raw body, reject stale/replayed events, persist the event ID once, and process asynchronously/idempotently.
- Admin authorization uses server-owned role data, not user-editable metadata. High-risk actions require step-up auth and dual approval.
- Ledger and audit events are append-only; corrections reference originals. Sensitive exports are encrypted, access logged, retained by policy, and excluded from analytics by default.
- Amounts use integer paise (preferred) or fixed decimal with currency; never binary floating point. All provider amounts are revalidated server-side.
- Locks/unique constraints protect one reservation, capture, refund, journal, and payout attempt per idempotency scope.

## Required test evidence

Evidence must include commit SHA, migration/function versions, environment, timestamp, command, result, sanitized artifacts, and reviewer. A unit-test assertion alone does not prove a deployed provider payload.

| Suite | Minimum proof |
|---|---|
| Static/contract | No order-creation `transfers`; no top-up/P2P/cashout endpoints; switches default deny |
| Ledger property | Random issue/reserve/commit/release/refund/reversal sequences remain balanced and non-negative |
| Concurrency/replay | Parallel reserve, confirm/cancel race, duplicate webhook/refund/payout, timeout then retry |
| Tender/refund | Wallet-only, promo+refund credit, credit+Razorpay, partial refund, max refund, chargeback |
| Settlement | Ineligible/held rows cannot pay; transfer ID uniqueness; unknown provider result does not retry blindly |
| COD | Seller-collected cash never enters online payable; fee receivable, refund, and optional approved offset reconcile |
| Authorization | Cross-buyer/seller denial, forged role/JWT claims, direct table writes, switch access, service-key absence |
| Reconciliation | Provider statement, bank settlement, journals, payables, credit lots/cache, and COD aging tie out |
| Kill switches | Each switch fails closed under credentials, linked account, stale worker, retry, and concurrent requests |
| UI language | Buyer restricted-credit disclosure; seller payable/earnings labels; no custody/withdrawable claim |

### Existing repository evidence and gaps

- Local evidence on 2026-08-08: `npm test -- --run src/test/wallet-mvp-money.test.ts` passed 15/15 tests for spend planning, allocation, settlement math, refunds, and zero-residual checkout. Retain CI output tied to the release commit before certification.
- Wallet migrations implement RLS, client-write revocation, idempotency indexes, reservations, lots, and double-entry rows. Database integration/property tests are still required.
- Settlement code requires a real `razorpay_transfer_id` before “settled”, and seller payout UI distinguishes owed from paid.
- `create-razorpay-order` now omits order-attached `transfers`; the hardening regression suite asserts payload-source absence. Deployment and provider request evidence are still required for certification.
- `cod_transactions` and seller copy now separate seller-collected COD from online payout balance. Migration-backed and live E2E evidence are still required before certification.

## Release and rollback evidence

The release packet contains approvals, configuration snapshot with switches off, schema/function hashes, test artifacts, reconciliation baseline, canary limits, on-call owner, rollback steps, and post-deploy queries. Rollback disables new movement first; it never deletes journals, provider events, or obligations already created.
