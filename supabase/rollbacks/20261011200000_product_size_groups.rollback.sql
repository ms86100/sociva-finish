-- Rollback for 20261011200000_product_size_groups.sql
--
-- Not a migration. Run manually, as one transaction, only if size groups must be
-- backed out. Phase 1 (product sizes) stays in place.
--
-- Every active group is undone first with admin_undo_size_group, so each old listing
-- comes back with its name, price, stock and on/off state, cart lines move back, and
-- favourites and stock alerts copied by the group are removed. If any group cannot be
-- undone (for example a size was added after grouping), the whole rollback stops and
-- nothing changes; remove that size or forward-fix instead.
--
-- Past orders keep their size label and price. Their size rows are archived, not deleted.

begin;

do $$
declare
  _batch uuid;
begin
  if to_regclass('public.product_size_merges') is null then
    raise notice 'product_size_merges does not exist; nothing to undo';
    return;
  end if;
  perform set_config('request.jwt.claims', '', true);
  for _batch in
    select distinct batch_id from public.product_size_merges where undone_at is null
  loop
    perform public.admin_undo_size_group(_batch);
  end loop;
end $$;

drop trigger if exists trg_guard_merged_product_listing on public.products;

drop function if exists public.admin_suggest_size_groups(uuid);
drop function if exists public.admin_undo_size_group(uuid);
drop function if exists public.admin_apply_size_group(uuid, jsonb, text, text);
drop function if exists public.admin_size_group_plan(uuid, jsonb, text, text);
drop function if exists public.size_group_assert_admin();
drop function if exists public.guard_merged_product_listing();

drop table if exists public.product_size_merges;

commit;
