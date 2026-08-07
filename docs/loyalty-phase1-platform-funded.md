# Loyalty Phase 1 — Platform-funded (shipped)

**Date:** 2026-08-07  
**Project:** `kkzkuyhgdvyecmxtmkpy`  
**Decision:** Model A — global buyer wallet, **platform-funded** redemptions.

Companion investigation: [`loyalty-points-investigation-report.md`](./loyalty-points-investigation-report.md)

---

## What shipped

### Schema
| Object | Role |
|--------|------|
| `loyalty_wallets` | Cached `available` / `pending` / lifetime counters; `funding_source='platform'` |
| `loyalty_ledger` | Immutable movements (`earn`, `redeem`, `reserve`/`release`/`commit` audit, `refund_restore`, `reverse_earn`, …) with optional `store_id`, `order_id`, `funding_source` |
| `loyalty_reservations` | Checkout holds (`held` → `committed` \| `released`) |
| `orders.loyalty_discount_amount` / `loyalty_points_redeemed` / `loyalty_reservation_id` | Money truth on each vendor order |
| `seller_settlements.platform_loyalty_subsidy` / `gross_before_loyalty` | Explicit platform cost |

Legacy `loyalty_points` rows were **migrated** into wallets + ledger (balances preserved: **107** outstanding across **3** users). Legacy table still receives earn mirrors for compatibility; balance RPCs read **wallets**.

### RPCs (SECURITY DEFINER, idempotent where noted)
- `get_loyalty_wallet` / `get_loyalty_balance` (self-only; admin may pass `_user_id`)
- `get_loyalty_history` (ledger)
- `quote_loyalty_redemption(_cart_amount_after_coupon)`
- `reserve_loyalty_points` / `commit_loyalty_reservation` / `release_loyalty_reservation`
- `commit_loyalty_for_orders` / `release_loyalty_for_orders` (edge/helpers)
- `apply_loyalty_to_checkout_orders` (proportional multi-seller allocation)
- `admin_loyalty_liability`
- `create_multi_vendor_orders(..., _loyalty_points)` — applies discount into `total_amount`
- Deprecated: `redeem_loyalty_points` returns `{ success:false, error:'deprecated' }`

### Money truth
```
Buyer pays     = Σ orders.total_amount          (post-coupon, post-loyalty; includes delivery)
Seller gross   = total_amount + loyalty_discount (= pre-loyalty GMV)
Platform subsidy = loyalty_discount_amount
Seller net     = gross − platform_fee
```

Razorpay / confirm paths already charge **DB** `total_amount`, so once loyalty is on the order, payment matches.

### Checkout flow
1. UI toggles points → optional `quote_loyalty_redemption` (display)
2. `create_multi_vendor_orders(_loyalty_points)` reserves + allocates proportionally (delivery fee excluded from redeemable base)
3. **COD:** commit immediately  
4. **Online:** hold until `confirm-razorpay-payment` → `commit_loyalty_for_orders`  
5. **Cancel / auto-cancel unpaid:** trigger releases hold or restores committed redeem per order

### Earn / clawback policy (chosen)
| Event | Policy |
|-------|--------|
| Earn | On `delivered`/`completed`: `FLOOR(total_amount/10)` min 1 (post-loyalty paid amount) + review +10 |
| Cancel before delivery (committed redeem) | Restore that order’s `loyalty_points_redeemed` |
| Payment fail / unpaid cancel (held) | Release full reservation when all sibling orders cancelled |
| Refund completed | Reverse earned × `refund_amount/total_amount`; restore redeemed × same fraction |

---

## Files
| Path | Change |
|------|--------|
| `supabase/migrations/20260807120000_loyalty_phase1_platform_funded.sql` | Schema + migrate + core RPCs |
| `supabase/migrations/20260807120100_loyalty_phase1_checkout_settlement.sql` | CMVO + settlement + earn/cancel/refund |
| `src/hooks/useLoyaltyRedeem.ts` | Quote/display only; no client redeem |
| `src/hooks/useCartPage.ts` | Passes `_loyalty_points`; removes best-effort redeem |
| `supabase/functions/confirm-razorpay-payment/index.ts` | Commits reservation after pay |
| `src/components/admin/analytics/PlatformOverview.tsx` | Loyalty liability metric |
| `src/components/loyalty/LoyaltyCard.tsx` | Platform-funded copy |
| `src/test/loyalty-phase1-money.test.ts` | Allocation + settlement unit tests |

---

## Deploy status (live `kkzkuyhgdvyecmxtmkpy`)
- Migrations applied via Supabase MCP (`loyalty_phase1_*`)
- Legacy `create_multi_vendor_orders` overload **dropped** (loyalty signature only)
- Edge: redeploy `confirm-razorpay-payment` after this change

---

## QA checklist
1. **COD + points:** toggle redeem → place COD → order `loyalty_discount_amount` set, `total_amount` reduced, wallet decreased, reservation `committed`
2. **Razorpay + points:** create online order → hold pending → pay → confirm commits; Razorpay amount = Σ `total_amount`
3. **Payment abandon:** unpaid auto-cancel → reservation `released`, points back to available
4. **Multi-seller:** two stores in cart → discounts proportional to merchandise bases; both orders show subsidy fields on delivery settlement
5. **Settlement:** on deliver, `gross_before_loyalty = total + loyalty`, `platform_loyalty_subsidy = loyalty`, seller net not silently cut without subsidy row
6. **Refund:** complete refund → earned reversed proportionally; redeemed restored proportionally
7. **Balances:** existing users still show pre-migration balances (spot-check wallets vs old sum)
8. **Admin:** Analytics → Loyalty Liability ≈ outstanding available points (₹)

```bash
# focused unit tests
npx vitest run src/test/loyalty-phase1-money.test.ts
```

---

## Not in this phase
Merchant-funded rates, campaigns, birthday/referral/VIP, full ROI dashboard, AUTH WhatsApp OTP, soft-delete everywhere.
