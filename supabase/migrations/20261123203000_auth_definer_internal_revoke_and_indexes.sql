-- Authenticated DEFINER: revoke internal/trigger-style RPCs (keep admin_* for admin UI).
-- Additional hot FK indexes + products initplan + buyer_wallets policy collapse.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'execute')
      AND (
        p.proname ~* '(^trg_|_trigger$|_on_order_|guard_|fn_expire_|fn_supersede_|fn_upsert_seller_metrics|seller_credit_on_|seller_credit_notify|seller_credit_maybe_notify|seller_credit_ensure_account|seller_credit_apply_|seller_credit_spend_active|seller_credit_rule$|seller_credit_setting$)'
        OR p.proname IN (
          'fn_expire_order_notifications',
          'fn_supersede_order_notifications',
          'fn_upsert_seller_metrics',
          'fn_get_seller_user_id'
        )
      )
  LOOP
    EXECUTE format(
      'revoke execute on function public.%I(%s) from public, anon, authenticated',
      r.proname,
      r.args
    );
    EXECUTE format(
      'grant execute on function public.%I(%s) to service_role',
      r.proname,
      r.args
    );
  END LOOP;
END $$;

create index if not exists idx_delivery_addresses_society_id on public.delivery_addresses (society_id);
create index if not exists idx_delivery_partners_user_id on public.delivery_partners (user_id);
create index if not exists idx_delivery_partner_pool_partner_id on public.delivery_partner_pool (partner_id);
create index if not exists idx_delivery_partner_pool_society_id on public.delivery_partner_pool (society_id);
create index if not exists idx_product_favorites_product_id on public.product_favorites (product_id);
create index if not exists idx_product_views_product_id on public.product_views (product_id);
create index if not exists idx_service_bookings_product_id on public.service_bookings (product_id);
create index if not exists idx_stock_watchlist_product_id on public.stock_watchlist (product_id);
create index if not exists idx_subscriptions_product_id on public.subscriptions (product_id);
create index if not exists idx_ride_chat_messages_sender_id on public.ride_chat_messages (sender_id);
create index if not exists idx_ride_chat_messages_society_id on public.ride_chat_messages (society_id);
create index if not exists idx_wallet_ledger_entries_lot_id on public.wallet_ledger_entries (lot_id);
create index if not exists idx_helphub_profiles_society_id on public.helphub_profiles (society_id);
create index if not exists idx_helphub_profiles_created_by on public.helphub_profiles (created_by);
create index if not exists idx_banner_section_products_product_id on public.banner_section_products (product_id);
create index if not exists idx_ai_review_log_product_id on public.ai_review_log (product_id);

drop policy if exists "Anyone can view available products from approved sellers" on public.products;
create policy "Anyone can view available products from approved sellers" on public.products
  for select using (
    ((approval_status = 'approved') and (exists (
      select 1 from seller_profiles sp
      where sp.id = products.seller_id
        and sp.verification_status = 'approved'
        and seller_credit_activation_satisfied(sp.id)
    )))
    or (exists (
      select 1 from seller_profiles sp
      where sp.id = products.seller_id and sp.user_id = (select auth.uid())
    ))
    or is_admin((select auth.uid()))
  );

drop policy if exists "Admins can view all buyer wallets" on public.buyer_wallets;
drop policy if exists "Users can view own buyer wallet" on public.buyer_wallets;
create policy "Users or admins can view buyer wallets" on public.buyer_wallets
  for select to authenticated
  using (
    (user_id = (select auth.uid()))
    or has_role((select auth.uid()), 'admin'::user_role)
  );
