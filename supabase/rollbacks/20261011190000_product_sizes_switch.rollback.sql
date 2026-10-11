-- Rollback for 20261011190000_product_sizes_switch.
-- Removes the insert guard and the setting. Existing sizes are not touched.
begin;
drop trigger if exists trg_guard_product_sizes_enabled on public.product_variants;
drop function if exists public.guard_product_sizes_enabled();
delete from public.system_settings where key = 'product_sizes_enabled';
commit;
