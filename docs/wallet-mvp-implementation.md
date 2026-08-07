# Sociva Credit (Wallet) MVP — Implementation Notes

**Date:** 2026-08-07  
**Architecture:** [`wallet-architecture-study.md`](./wallet-architecture-study.md)  
**Status:** **CLOSED (Phase 1 MVP)** — code + remote deploy on project `kkzkuyhgdvyecmxtmkpy` (Sociva).

## What shipped (Phase 1 MVP)

| Area | Detail |
|------|--------|
| Schema | `buyer_wallets`, `wallet_credit_lots`, `wallet_ledger_txns`, `wallet_ledger_entries`, `wallet_reservations` |
| Orders | `wallet_cash_amount`, `wallet_promo_amount`, `wallet_reservation_id` |
| Settlements | `wallet_cash_applied`, `wallet_promo_applied` |
| Refunds | `refund_destination` (`original_payment` \| `wallet`), `wallet_credit_amount` |
| Checkout | `create_multi_vendor_orders(..., _wallet_amount)` after loyalty |
| Pay confirm | `confirm-razorpay-payment` → `commit_wallet_for_orders` |
| Refunds | `refund-processor` wallet branch → `complete_wallet_refund` (no Razorpay) |
| Expiry | `expire_wallet_lots` + edge `process-wallet-expiry` + pg_cron `expire_wallet_lots_daily` |
| UI | Orders `WalletCard`, cart Sociva Credit toggle, refund destination radios |
| Tests | `src/test/wallet-mvp-money.test.ts` (15/15 pass) |

**Explicitly deferred (per study):** cash top-up / Add money, P2P, withdraw, bank PPI, gift catalog, statement PDF/CSV, instrument-aware partial refund UI polish, admin promo-issue UI (RPC `issue_wallet_promo` available).

## Money truth

```
Buyer gateway/COD pay = orders.total_amount
  (after coupon → loyalty → wallet)

Seller gross = total_amount + loyalty_discount + wallet_cash + wallet_promo
Platform loyalty subsidy = loyalty_discount
Wallet promo = platform promo expense (liability drawdown audited on lots)
Wallet cash = application of store-credit liability
```

Order of application: **coupon → loyalty → wallet → gateway**.

## Deployed to remote (2026-08-07) — project `kkzkuyhgdvyecmxtmkpy`

### Migrations applied
| Name | Source file |
|------|-------------|
| `wallet_mvp_sociva_credit` | `supabase/migrations/20260807120312_wallet_mvp_sociva_credit.sql` |
| `wallet_mvp_checkout_settlement` | `supabase/migrations/20260807120334_wallet_mvp_checkout_settlement.sql` |
| `wallet_mvp_e2e_gaps` | `supabase/migrations/20260807121744_wallet_mvp_e2e_gaps.sql` |

Verified live: `buyer_wallets`, `wallet_reservations`, CMVO signature includes `_wallet_amount`, `complete_wallet_refund`, wallet RPC set.

### Edge functions redeployed (`verify_jwt=false`)
| Function | Version | Wallet wiring |
|----------|---------|---------------|
| `confirm-razorpay-payment` | **v53** | `commit_wallet_for_orders` after pay confirm |
| `refund-processor` | **v24** | `complete_wallet_refund` when `refund_destination=wallet`; residual Razorpay otherwise |
| `process-wallet-expiry` | **v1** (new) | `expire_wallet_lots(200)` for ops/manual invoke |

### Cron verified
| Job | Schedule | Command | Active |
|-----|----------|---------|--------|
| `expire_wallet_lots_daily` | `20 0 * * *` | `SELECT public.expire_wallet_lots(200);` | yes |

### Types
`src/integrations/supabase/types.ts` regenerated to include wallet tables + RPCs (`buyer_wallets`, `get_buyer_wallet`, `_wallet_amount`, etc.).

## Manual QA checklist

1. Admin: `issue_wallet_promo(user, 100, now()+30d)` → buyer sees Sociva Credit on Orders.
2. Cart: toggle credit → bill shows credit line → residual Razorpay amount matches Σ `total_amount`.
3. COD + credit → reservation `committed`, balances drop.
4. Online + credit → hold until confirm → commit.
5. Abandon unpaid → cancel releases wallet hold.
6. Refund → choose Instant Sociva Credit → approve → wallet credited, no Razorpay call.
7. Refund → original method on split-pay order → gateway refunds residual only; wallet spend restored.
8. Loyalty + wallet coexist on same checkout (separate cards/balances).
9. Wallet-only (₹0 residual) → `payment_method=wallet`, orders land `payment_status=paid` without client UPDATE.

## Key files

- `supabase/migrations/20260807120312_wallet_mvp_sociva_credit.sql`
- `supabase/migrations/20260807120334_wallet_mvp_checkout_settlement.sql`
- `supabase/migrations/20260807121744_wallet_mvp_e2e_gaps.sql`
- `supabase/functions/confirm-razorpay-payment/index.ts`
- `supabase/functions/refund-processor/index.ts`
- `supabase/functions/process-wallet-expiry/index.ts`
- `src/hooks/useWalletCredit.ts`, `src/components/wallet/WalletCard.tsx`
- `src/hooks/useCartPage.ts`, `src/pages/CartPage.tsx`

## E2E gap fixes (included in deploy)

- **Wallet-only paid flag:** CMVO marks ₹0-residual wallet/loyalty-covered orders `paid` + `payment_type=wallet` inside SECURITY DEFINER. Cart uses `_payment_method: 'wallet'`.
- **CMVO overload:** Single wallet-aware signature (loyalty + `_wallet_amount`); keeps `compute_store_status` + fulfillment-specific payment configs.
- **Cron:** `expire_wallet_lots_daily` at `20 0 * * *`. Edge `process-wallet-expiry` for manual/ops.
- **Confirm / refund / cancel:** `commit_wallet_for_orders`, `complete_wallet_refund`, cancel → `release_wallet_reservation` / `restore_wallet_for_order`.

## Remaining / deferred (not Phase 1 blockers)

- Legal: store-credit vs PPI still requires counsel before any top-up (unchanged from study).
- No Add money / PPI top-up (by design).
- Phase 2+: admin promo UI, statements, instrument-aware refund polish.
