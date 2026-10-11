-- Product sizes switch.
--
-- App builds released before sizes cannot choose a size, so a sized product
-- would fail to add to cart there. New sizes can only be created while the
-- admin setting product_sizes_enabled is 'true'. Turn it on only after the
-- minimum app versions are set, so older installs see the update screen first.
-- Sizes that already exist keep working when the switch is off.

insert into public.system_settings (key, value, description)
values (
  'product_sizes_enabled',
  to_jsonb('false'::text),
  'Lets sellers add sizes such as 250 g / 500 g / 1 kg. Before turning this on, set the minimum app versions so phone apps without sizes show the update screen.'
)
on conflict (key) do nothing;

create or replace function public.guard_product_sizes_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select ss.value #>> '{}' from public.system_settings ss where ss.key = 'product_sizes_enabled'), 'false') <> 'true' then
    raise exception 'SIZES_DISABLED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_product_sizes_enabled() from public, anon, authenticated;

drop trigger if exists trg_guard_product_sizes_enabled on public.product_variants;
create trigger trg_guard_product_sizes_enabled
  before insert on public.product_variants
  for each row execute function public.guard_product_sizes_enabled();
