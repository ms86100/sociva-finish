# Production-copy test: seller/product self-approval trigger

Do not apply to live production (`kkzkuyhgdvyecmxtmkpy`) until this copy test passes.

Source migration (staging applied): `supabase/migrations/20261123235910_seller_product_self_approval_public_is_admin.sql`

Production has no `sociva_private` schema. This file calls `public.is_admin(auth.uid())`, which already exists on production. Do not copy the earlier staging version that calls `sociva_private.is_admin`.

## Setup

1. Create a Supabase branch or restore a recent production backup. Do not use live production.
2. Apply only that one migration.
3. Use two JWTs, never SQL for the deny/allow proof:
   - Seller: an existing approved store owner (not a platform admin).
   - Admin: one of the three known platform admins.

## Seller JWT (must fail closed)

- `PATCH seller_profiles` set `verification_status=approved` on own store -> 403 / `42501`
- `POST seller_profiles` with `verification_status=approved` -> 403 / `42501`
- `PATCH products` set `approval_status=approved` on own listing -> 403 / `42501`
- `PATCH seller_profiles` set `is_featured=true` on own store -> 403 / `42501`
- Control: `PATCH seller_profiles` own row `verification_status=pending` still succeeds
- Control: seller can still create a draft/pending product

## Admin JWT (must still work)

- Admin can set a store to `approved`
- Admin can set a product to `approved`
- App seller-approval UI still loads the store list

## After copy test

If all of the above hold, this is the next single production hotfix candidate. It is still not authorized for live production in this pass.
