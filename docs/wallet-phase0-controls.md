# SOCIVA Money Movement — Phase 0 Control Freeze

**Status:** Engineering policy baseline; runtime enforcement must be verified before release  
**Effective:** 2026-08-08  
**Supersedes where inconsistent:** [`wallet-architecture-study.md`](./wallet-architecture-study.md) and [`wallet-mvp-implementation.md`](./wallet-mvp-implementation.md)

This document records conservative defaults. It is not legal, tax, accounting, or provider approval.

## Frozen product and funds-flow defaults

1. **Platform collect, deferred settlement.** Online buyer funds are collected by the platform payment account. SOCIVA records a seller payable only after a valid paid order and releases it only after delivery/completion, cooldown, refund/hold checks, reconciliation, and an approved payout attempt.
2. **Seller UI is not a wallet.** Use “Earnings”, “Payable”, “On hold”, and “Paid out”. Never present an internal balance as stored value, custody, a bank account, or withdrawable funds.
3. **SOCIVA Credit is a restricted buyer entitlement.** It is non-loadable, non-transferable, non-withdrawable, usable only against eligible SOCIVA purchases, and separate from loyalty points. Buyer top-up, cashout, P2P, interest, and credit-line features are disabled.
4. **COD is a separate rail.** Seller-collected COD is cash already received by the seller. It must not increase seller withdrawable/payable balance. Record seller gross, platform fees/taxes due, refunds, and any net receivable from the seller separately.
5. **No order-attached Route transfer.** Razorpay order creation must never include `transfers`. All seller payouts remain deferred and originate only from the settlement worker after eligibility.
6. **Provider mode is closed by default.** A future provider-mode switch may enable a reviewed payout integration only after approvals and rollout gates below. A linked-account ID alone is never authorization to move money.

## Current repository conformance

| Control | Current evidence | Phase 0 disposition |
|---|---|---|
| Buyer top-up/P2P/cashout absent | Wallet schema has no top-up ledger type; MVP notes defer these features | Keep absent; add negative API/UI tests |
| Route worker default off | `razorpay_route_enabled` is seeded `false`; worker marks rows eligible when off | Retain as emergency kill switch |
| Paid-out claim requires transfer ID | Settlement worker and notification migration require `razorpay_transfer_id` | Retain; reconcile provider evidence daily |
| Order-attached transfers disabled | `create-razorpay-order` now uses platform collect for every cart and contains no `orderPayload.transfers` branch | Implemented in repository; deployment/provider payload evidence remains a release gate |
| Seller display is payable/earnings | Payout page says “Ledger only — not a bank payout” | Keep; replace ambiguous “balance/withdraw” copy if introduced |
| COD segregated from payout | `cod_transactions` tracks the collector and confirmation separately; seller UI states COD is not online payout balance | Implemented behind migration; database/E2E evidence remains a release gate |

Code and documentation do not by themselves prove the deployed production flow. Until migration, function deployment, provider payload, and database evidence are verified, keep linked-account Route use disabled and do not represent COD as withdrawable.

## Professional approvals required

No item below is approved by this document.

| Decision owner | Written decision required |
|---|---|
| **India-qualified legal counsel** | Classification and terms for restricted SOCIVA Credit; refund-to-credit consent; expiry, breakage, consumer disclosures; marketplace collection and settlement model; whether any PPI/payment-aggregator requirements apply |
| **Tax adviser** | GST/TDS/TCS treatment, invoice timing, discounts, promo credits, COD fee collection, refunds, and seller statements |
| **Chartered accountant/controller** | Final chart of accounts, principal-versus-agent presentation, restricted-credit liability/contra-revenue treatment, breakage, reconciliation ownership, reserve policy |
| **Razorpay/provider** | Platform-collect contract, Route account model, permitted settlement timing, refund/chargeback behavior, idempotency, webhook truth, and approved API mode |
| **Security/privacy** | Privileged roles, retention, incident response, provider credential handling, audit access |

Any approval must identify approver, date, version, scope, conditions, and expiry/review date in the release evidence.

## Kill switches and safe states

| Control | Default | Safe-state behavior |
|---|---|---|
| `razorpay_route_enabled` | `false` | Settlement rows may become eligible; no transfer and no “paid out” |
| `auto_settle_enabled` | `false` until rollout approval | No automatic eligibility/payout run |
| `provider_payout_mode` *(required)* | `disabled` | Worker cannot call any payout provider even if credentials and linked account exist |
| `wallet_spend_enabled` *(required)* | `false` before each staged launch | Checkout ignores/rejects new credit reservations; history and refunds remain readable |
| `wallet_issue_enabled` *(required)* | `false` | No promo/support issuance; reversal and read paths remain available |
| `wallet_refund_credit_enabled` *(required)* | `false` | Refunds use reviewed original-method/manual policy; never silently convert destination |
| `cod_payable_offset_enabled` *(required)* | `false` | COD is reported separately; no automatic netting against online seller payable |

Required controls not already implemented must be server-side, deny-by-default, audited, and inaccessible to sellers/buyers. Changing a money-movement switch requires dual control, a reason, a time-box where practical, and an immutable audit event.

## Phase 0 exit gates

- [ ] Order creation payload tests and provider-side evidence prove `transfers` is absent for every cart shape.
- [ ] Platform-collect and deferred-settlement terms are approved by counsel and provider.
- [ ] Accounting and tax owners approve the chart and journal templates.
- [ ] COD never enters seller payable/withdrawable totals; COD receivables and refunds reconcile separately.
- [ ] Buyer UI/API have no top-up, P2P, cashout, transfer, bank-link, or withdrawal path.
- [ ] Seller UI uses payable/earnings language and distinguishes pending, eligible, held, paid, and seller-collected COD.
- [ ] Every “paid out” row has a unique provider transfer ID and reconciled provider status.
- [ ] Kill-switch tests prove no external money movement and no new credit issuance/spend in safe state.
- [ ] Security boundary and evidence requirements in [`wallet-engineering-briefs.md`](./wallet-engineering-briefs.md) pass.

Failure of any gate is a no-go. Manual database edits are not an acceptable workaround.
