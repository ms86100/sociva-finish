-- Staging hardening: revoke anon EXECUTE on high-risk SECURITY DEFINER RPCs.
-- Keep authenticated where the RPC enforces admin/seller checks internally.
-- Wipe / credential writers: service_role only.

REVOKE EXECUTE ON FUNCTION public._loyalty_account_wipe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._loyalty_account_wipe(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_admin_credential(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_admin_credential(text, text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_approve_whatsapp_evolution_live(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_audit_whatsapp_cross_provider_retry(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_force_complete_delivery(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_force_fail_delivery(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_command_center_snapshot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_reversible_seller_charges(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_billing_audit(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_financial_timeline(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_ledger(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_packages() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_purchases(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_settings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credit_thresholds() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_seller_credits(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_loyalty_liability() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_rollback_whatsapp_provider_to_meta(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_run_seller_credit_monetization_certification() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_seller_credit_flag(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_whatsapp_provider(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_seller_billing_rule(text, numeric, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_seller_credit_setting(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_seller_credit_threshold(text, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_whatsapp_evolution_readiness(boolean, boolean, boolean, boolean, boolean, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_seller_credit_package(uuid, text, numeric, numeric, boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_verify_seller_credit_production_purchase(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_whatsapp_delivery_stats(timestamp with time zone, text) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.conversations_delete_message(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_seller_credit_purchase(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_seller_credit_purchase_amount(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fail_seller_credit_purchase(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_society_admins_issue(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_banner_analytics_daily() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_banner_analytics_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_banner_section_analytics() FROM PUBLIC, anon;
