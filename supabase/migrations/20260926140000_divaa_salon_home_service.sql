-- Divaa Unisex Salon listings move from Beauty to Salon.
-- Home service is a seller choice, inherited by products unless a product turns it off.
-- Product ids stay the same, so share links and orders are unchanged.

alter table public.seller_profiles
  add column if not exists home_service_available boolean not null default false,
  add column if not exists home_service_fee numeric;

alter table public.products
  add column if not exists home_service_available boolean;

comment on column public.seller_profiles.home_service_available is
  'Seller can visit the customer. Contact and booking flows stay as they are.';
comment on column public.seller_profiles.home_service_fee is
  'Optional extra charge for a home visit. Null means no extra charge.';
comment on column public.products.home_service_available is
  'Null inherits the seller setting. False turns home service off for this listing.';

-- Ask-for-price contact listings are stored at 0. Salon still requires a price
-- on new edits, so this one category move skips that check and keeps the prices.
alter table public.products disable trigger trg_validate_product_price;

update public.products
set category = 'salon'
where seller_id = '9a589616-d29e-4652-9f43-be68afa3748b'
  and category = 'beauty';

alter table public.products enable trigger trg_validate_product_price;

update public.seller_profiles
set categories = array['salon']::text[],
    home_service_available = true,
    home_service_fee = null
where id = '9a589616-d29e-4652-9f43-be68afa3748b'
  and business_name = 'Divaa Unisex Salon';
