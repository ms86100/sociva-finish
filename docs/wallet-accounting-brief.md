# SOCIVA Money Movement — Accounting Engineering Brief

**Status:** Proposed engineering subledger; controller, tax, and legal approval required  
**Scope:** Platform-collected online payments, restricted buyer SOCIVA Credit, deferred seller settlement, and seller-collected COD

This is an engineering model, not an approved accounting policy.

## Source-of-truth hierarchy

There is no universal “balance” source. Use the authority for the question:

1. **External cash movement:** signed provider webhook plus provider API/statement and bank statement. A client callback is never proof.
2. **Economic obligation:** balanced, immutable internal journal transaction with idempotency key and source references.
3. **Business lifecycle:** orders, payments, refunds, disputes, and `seller_settlements` state machines.
4. **Credit entitlement/allocation:** wallet ledger entries, lots, and reservations.
5. **Presentation only:** cached wallet rows, KPIs, dashboards, notifications, and seller totals. Rebuild these from higher authorities.

Conflicts do not get overwritten. Freeze the affected account, preserve evidence, post a reviewed correction/reversal, and record the incident.

## Proposed chart of accounts

Final numbering and classification require controller/tax approval.

| Code | Account | Normal | Purpose |
|---|---|---|---|
| 1010 | Provider clearing — Razorpay | Debit | Captured online funds not yet matched to bank |
| 1020 | Bank — platform collections | Debit | Settled platform-collected cash |
| 1090 | Provider/bank reconciliation variance | Debit | Temporary investigated variance; must age to zero |
| 1110 | Seller COD fee receivable | Debit | Platform fees/taxes owed by a seller who collected COD |
| 1120 | Chargeback/refund recoverable | Debit | Amount recoverable from seller/provider where approved |
| 2010 | Seller payable — online | Credit | Deferred amount owed for eligible platform-collected orders |
| 2020 | Buyer SOCIVA Credit liability — refund | Credit | Restricted refund credit outstanding, subject to accounting approval |
| 2030 | Buyer SOCIVA Credit liability — promo | Credit | Outstanding promo entitlement, subject to liability/contra-revenue decision |
| 2040 | Refund payable — original method | Credit | Approved but not provider-confirmed refund |
| 2050 | Taxes/withholding payable | Credit | GST/TDS/TCS or other amounts per tax-approved rules |
| 2060 | Chargeback/reserve payable adjustment | Credit | Holds/reserves against otherwise payable seller amounts |
| 4010 | Platform commission revenue | Credit | Earned marketplace fee at approved recognition point |
| 4020 | Delivery/service revenue | Credit | Platform service revenue where SOCIVA is principal |
| 4090 | Sales/refund contra-revenue | Debit | Platform revenue reversals |
| 5010 | Promo/credit expense | Debit | Platform-funded restricted credits when approved as expense |
| 5020 | Provider and payout fees | Debit | Gateway/Route fees borne by platform |
| 5030 | Credit breakage/expiry | Credit | Use only with legal and accounting approval |
| 5040 | Fraud/chargeback loss | Debit | Unrecoverable loss after approved recovery process |

Seller payable is an obligation, not seller custody. SOCIVA Credit liability is a restricted buyer entitlement, not cash on deposit. Seller-collected COD is not platform cash and not a seller payout balance.

## Required journal envelope

Every journal group has: `journal_id`, event type/version, event time and posting time, currency, balanced lines, order/payment/refund/settlement IDs, provider IDs, seller/buyer scope, idempotency key, actor, approval reference where needed, and reversal link. Posted rows are append-only.

## Journal templates

Amounts below are illustrative: `G` gross order amount before platform fee, `F` platform fee, `S = G − F` seller net, `C` SOCIVA Credit applied, `R` refund, `P` promo issued. Taxes are separate approved lines.

### Online capture — platform collect

- Dr Provider clearing `G − C`
- Dr Buyer SOCIVA Credit liability `C` (split refund/promo accounts by consumed lots)
- Cr Seller payable — online `S`
- Cr Platform commission revenue `F`

Post only after provider capture truth (or a fully credit-covered order) and validated order allocation. Credit application reduces an existing entitlement; it does not represent new cash.

### Provider settlement to platform bank

- Dr Bank — platform collections `X`
- Dr Provider fees `fee`
- Cr Provider clearing `X + fee`

Reconcile gross captures, refunds, fees, and settlement batches to the provider statement.

### Deferred seller payout

- Dr Seller payable — online `S`
- Cr Provider clearing/bank `S`

Post “paid out” only after a unique provider transfer is accepted and subsequently reconciled. Failed/unknown transfers remain processing/held; never create a second transfer without idempotent provider inquiry.

### Seller-collected COD completion

- Dr Seller COD fee receivable `F`
- Cr Platform commission revenue `F`

Do **not** debit platform cash and do **not** credit seller payable for `G` or `S`: the seller already possesses the buyer cash. If an approved policy lets SOCIVA net COD fees against online payable, post a separate, referenced offset:

- Dr Seller payable — online `F`
- Cr Seller COD fee receivable `F`

Automatic netting remains disabled until legal, tax, accounting, seller-terms, and negative-balance collection rules are approved.

### Issue restricted refund credit

- Dr Refund payable — original method or approved refund clearing `R`
- Cr Buyer SOCIVA Credit liability — refund `R`

Destination conversion requires explicit buyer consent and eligibility. It does not create a withdrawable claim.

### Issue platform-funded promo

- Dr Promo/credit expense `P`
- Cr Buyer SOCIVA Credit liability — promo `P`

Alternative contra-revenue treatment requires controller/tax approval and must be versioned by campaign.

### Credit reservation, commit, and release

Reservation/release are entitlement subledger reclassifications, not general-ledger expense:

- Reserve: available credit liability → held credit liability
- Commit: held credit liability is debited as part of online capture
- Release: exact reverse of reserve, preserving original lot and expiry

### Original-method refund before seller payout

- Dr Seller payable for seller-funded portion
- Dr Sales/refund contra-revenue for platform-funded portion
- Cr Refund payable — original method `R`

When provider confirms: Dr Refund payable; Cr Provider clearing/bank. Restore consumed SOCIVA Credit only according to the tender allocation and approved policy; never refund more than the original economic amount.

### Refund after seller payout / chargeback

- Dr Chargeback/refund recoverable from seller for approved recoverable portion
- Dr Platform contra-revenue/loss for platform portion
- Cr Refund payable or Provider clearing

Recovery, reserves, and negative seller positions require approved seller terms. They must not silently create a negative “wallet”.

### Promo expiry or correction

Expiry, if legally/accountingly approved:

- Dr Buyer SOCIVA Credit liability — promo
- Cr Credit breakage/expiry or approved expense reversal

Errors use a linked reversing journal; never update/delete posted lines or lots.

## Reconciliation controls

Daily and before every payout batch:

- Provider captures − refunds − chargebacks − provider settlements = provider clearing.
- Sum open online seller obligations = seller payable control account.
- Wallet liability control accounts = immutable ledger totals = lot/reservation detail = wallet cache.
- Every paid settlement has exactly one provider transfer ID; every provider transfer maps to one approved payout attempt.
- COD completed gross is reported separately; COD fee receivable plus approved offsets/collections ages to zero.
- Variance, orphan provider event, duplicate ID, negative cache, or unbalanced journal freezes the affected payout/credit path.

Month-end evidence includes signed extracts, hashes/counts, aging, variance disposition, approver, and retained provider/bank statements.
