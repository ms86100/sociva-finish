-- Logo Cab Services: Contact Seller catalogue for SRGF / Bangalore.
-- Reuses the existing contact enquiry + push pipeline. No booking or checkout changes.
-- Idempotent. Attaches to the live buyer account for +917738321817 (Yash Gupta).

INSERT INTO public.parent_groups (
  slug, name, icon, color, description, sort_order, is_active, layout_type,
  requires_license, license_mandatory, image_url
)
VALUES (
  'travel',
  'Cabs & Travel',
  '🚕',
  'bg-sky-100 text-sky-700',
  'Airport transfers, local cabs, sightseeing, outstation trips, self-drive and driver on hire',
  13,
  true,
  'ecommerce',
  false,
  false,
  'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&q=80'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  description = EXCLUDED.description,
  is_active = true,
  layout_type = EXCLUDED.layout_type,
  requires_license = false,
  license_mandatory = false,
  image_url = EXCLUDED.image_url,
  updated_at = now();

INSERT INTO public.category_config (
  category, display_name, icon, color, parent_group, layout_type,
  primary_button_label, requires_price, is_negotiable, is_physical_product,
  has_quantity, requires_availability, has_duration, duration_label, has_date_range,
  requires_delivery, show_veg_toggle, requires_preparation, requires_time_slot,
  enquiry_only, supports_cart, review_dimensions, transaction_type, display_order,
  is_active, default_sort, name_placeholder, description_placeholder, price_label,
  show_duration_field, default_action_type, lead_time_hours, accepts_preorders,
  supports_addons, supports_recurring, supports_staff_assignment,
  price_prefix, placeholder_emoji, requires_license, license_mandatory,
  image_aspect_ratio, image_object_fit, supports_brand_display,
  supports_warranty_display, seller_domain, image_url
)
VALUES
  (
    'airport_transfers', 'Airport Transfers', '✈️', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, true, 'Duration', false,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 1,
    true, 'popular',
    'e.g. Standard Airport Transfer',
    'Pickup, airport, vehicle and what the starting price includes',
    'Starting price',
    false, 'contact_seller', null, false,
    false, false, false,
    'From', 'plane', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1436491865332-7a61a1093801?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'local_trips', 'Local Bangalore Trips', '🏙️', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, true, 'Hours', false,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 2,
    true, 'popular',
    'e.g. 4 Hours / 40 KM city trip',
    'Included hours, kilometres and extra charges to confirm',
    'Package price',
    true, 'contact_seller', null, false,
    false, false, false,
    null, 'city', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'sightseeing', 'Sightseeing Packages', '🌄', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, false, null, false,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 3,
    true, 'popular',
    'e.g. Nandi Hills Trip',
    'Destination, advertised package price and what still needs confirmation',
    'Package price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'mountain', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'outstation', 'Outstation & Group Travel', '🛣️', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, false, null, true,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 4,
    true, 'popular',
    'e.g. Outstation trip',
    'Origin, destination, vehicle and indicative per-km rates',
    'Indicative price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'road', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'self_drive', 'Self-Drive Rentals', '🔑', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, false, null, true,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 5,
    true, 'popular',
    'e.g. Kia Sonet self-drive',
    'Vehicle, advertised starting price and what the seller must confirm',
    'Starting price',
    false, 'contact_seller', null, false,
    false, false, false,
    'From', 'key', false, false,
    '1:1', 'cover', true, false, 'listing',
    'https://images.unsplash.com/photo-1606664512234-273f8f0da5be?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'driver_hire', 'Driver on Hire', '🧑‍✈️', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, true, 'Hours', false,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 6,
    true, 'popular',
    'e.g. Local driver 4 hours',
    'Duration, advertised price and whether the customer provides the vehicle',
    'Advertised price',
    true, 'contact_seller', null, false,
    false, false, false,
    null, 'driver', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1449965408869-eaa3f349e98f?auto=format&fit=crop&w=800&q=80'
  ),
  (
    'other-travel', 'Other Cabs & Travel', '🚕', 'bg-sky-100 text-sky-700', 'travel', 'grid',
    'Contact Seller', false, true, false,
    false, false, false, null, false,
    false, false, false, false,
    true, false, null, 'contact_enquiry', 9999,
    true, 'popular',
    'e.g. Custom cab request',
    'Describe the trip so the seller can quote',
    'Price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'taxi', false, false,
    '1:1', 'cover', false, false, 'listing',
    'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800&q=80'
  )
ON CONFLICT (category) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  parent_group = EXCLUDED.parent_group,
  layout_type = EXCLUDED.layout_type,
  primary_button_label = EXCLUDED.primary_button_label,
  requires_price = EXCLUDED.requires_price,
  is_physical_product = EXCLUDED.is_physical_product,
  has_quantity = EXCLUDED.has_quantity,
  has_duration = EXCLUDED.has_duration,
  duration_label = EXCLUDED.duration_label,
  has_date_range = EXCLUDED.has_date_range,
  supports_cart = EXCLUDED.supports_cart,
  enquiry_only = EXCLUDED.enquiry_only,
  transaction_type = EXCLUDED.transaction_type,
  default_action_type = EXCLUDED.default_action_type,
  seller_domain = EXCLUDED.seller_domain,
  price_prefix = EXCLUDED.price_prefix,
  name_placeholder = EXCLUDED.name_placeholder,
  description_placeholder = EXCLUDED.description_placeholder,
  placeholder_emoji = EXCLUDED.placeholder_emoji,
  image_url = EXCLUDED.image_url,
  is_active = true,
  updated_at = now();

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, action.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('contact_seller'), ('request_service')) AS action(action_type)
WHERE cc.category IN (
  'airport_transfers', 'local_trips', 'sightseeing', 'outstation',
  'self_drive', 'driver_hire', 'other-travel'
)
ON CONFLICT (category_config_id, action_type) DO NOTHING;

INSERT INTO public.subcategories (
  category_config_id, slug, display_name, display_order, icon, is_active, origin, review_status
)
SELECT cc.id, v.slug, v.display_name, v.display_order, v.icon, true, 'system', 'approved'
FROM public.category_config cc
CROSS JOIN (
  VALUES
    ('airport_transfers', 'standard-airport-pickup', 'Standard Pickup', 1, '✈️'),
    ('airport_transfers', 'luxury-airport-transfer', 'Luxury Transfer', 2, '✨'),
    ('airport_transfers', 'shared-airport-ride', 'Shared Airport Ride', 3, '👥'),
    ('local_trips', 'local-4hr-40km', '4 Hours / 40 KM', 1, '🕓'),
    ('local_trips', 'local-8hr-80km', '8 Hours / 80 KM', 2, '🕗'),
    ('sightseeing', 'nandi-hills', 'Nandi Hills', 1, '🌄'),
    ('sightseeing', 'mysore-trip', 'Mysore', 2, '🏰'),
    ('sightseeing', 'bannerghatta', 'Bannerghatta', 3, '🐯'),
    ('outstation', 'outstation-rate-card', 'Per KM Rate Card', 1, '🛣️'),
    ('outstation', 'outstation-carpool', 'Shared Outstation', 2, '👥'),
    ('self_drive', 'kia-sonet-rental', 'Kia Sonet', 1, '🔑'),
    ('driver_hire', 'local-driver', 'Local Driver', 1, '🧑‍✈️'),
    ('driver_hire', 'outstation-driver', 'Outstation Driver', 2, '🛣️')
) AS v(category, slug, display_name, display_order, icon)
WHERE cc.category = v.category
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.category_status_flows (
  parent_group, transaction_type, status_key, sort_order, actor,
  is_terminal, is_success, is_transit, requires_otp, otp_type,
  display_label, seller_display_label, buyer_display_label,
  seller_hint, buyer_hint, notify_buyer, notify_seller,
  seller_notification_title, seller_notification_body,
  notification_title, notification_body, color, icon, display_name, statuses
)
SELECT
  'travel',
  d.transaction_type,
  d.status_key,
  d.sort_order,
  d.actor,
  d.is_terminal,
  d.is_success,
  d.is_transit,
  d.requires_otp,
  d.otp_type,
  d.display_label,
  d.seller_display_label,
  d.buyer_display_label,
  d.seller_hint,
  d.buyer_hint,
  d.notify_buyer,
  d.notify_seller,
  d.seller_notification_title,
  d.seller_notification_body,
  d.notification_title,
  d.notification_body,
  d.color,
  d.icon,
  d.display_name,
  d.statuses
FROM public.category_status_flows d
WHERE d.parent_group = 'default'
  AND d.transaction_type = 'contact_enquiry'
  AND NOT EXISTS (
    SELECT 1
    FROM public.category_status_flows existing
    WHERE existing.parent_group = 'travel'
      AND existing.transaction_type = 'contact_enquiry'
      AND existing.status_key = d.status_key
  );

INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status,
  allowed_actor, allowed_roles, is_side_action, display_label
)
SELECT
  'travel',
  'contact_enquiry',
  x.from_status,
  x.to_status,
  x.allowed_actor,
  ARRAY['seller']::text[],
  x.is_side_action,
  x.display_label
FROM (
  VALUES
    ('enquired', 'quoted',    'seller', false, 'Accept enquiry'),
    ('quoted',   'completed', 'seller', false, 'Mark delivered'),
    ('enquired', 'cancelled', 'seller', true,  'Decline enquiry'),
    ('quoted',   'cancelled', 'seller', true,  'Cancel enquiry')
) AS x(from_status, to_status, allowed_actor, is_side_action, display_label)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.category_status_transitions t
  WHERE t.parent_group = 'travel'
    AND t.transaction_type = 'contact_enquiry'
    AND t.from_status = x.from_status
    AND t.to_status = x.to_status
);

DO $$
DECLARE
  v_user uuid := '9cfb9f6b-7110-429d-8c02-a1fc27ece350';
  v_society uuid := '4295d566-08d3-42e7-8d2f-936f2b52607c';
  v_seller uuid;
  v_lat numeric := 13.0702556;
  v_lng numeric := 77.7516193;
  v_phone text := '+917738321817';
  v_cover text := 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1400&q=80';
  v_profile text := 'https://images.unsplash.com/photo-1449965408869-eaa3f349e98f?auto=format&fit=crop&w=400&q=80';
  v_vehicle_options jsonb := jsonb_build_object(
    'options', jsonb_build_array(
      jsonb_build_object(
        'label', 'Vehicle preference',
        'values', jsonb_build_array(
          'Sedan 4+1',
          'SUV Ertiga 6+1',
          'Innova Crysta 7+1',
          'Tempo Traveller AC 12+1',
          'Force Urbania 12+1'
        )
      )
    )
  );
  v_rate_card jsonb := jsonb_build_object(
    'rows', jsonb_build_array(
      jsonb_build_object('Vehicle', 'Sedan', 'Seating', '4+1', 'Advertised rate', 'Rs 13/km', 'Driver allowance', 'Rs 400 - basis pending confirmation'),
      jsonb_build_object('Vehicle', 'SUV (Ertiga)', 'Seating', '6+1', 'Advertised rate', 'Rs 16/km starting', 'Driver allowance', 'Rs 500 - basis pending confirmation'),
      jsonb_build_object('Vehicle', 'Innova Crysta', 'Seating', '7+1', 'Advertised rate', 'Rs 20/km', 'Driver allowance', 'Rs 650 - basis pending confirmation'),
      jsonb_build_object('Vehicle', 'Tempo Traveller AC', 'Seating', '12+1', 'Advertised rate', 'Rs 22/km', 'Driver allowance', 'Rs 700 - basis pending confirmation'),
      jsonb_build_object('Vehicle', 'Force Urbania', 'Seating', '12+1', 'Advertised rate', 'Rs 38/km', 'Driver allowance', 'Rs 800 - basis pending confirmation')
    )
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_user
      AND p.name = 'Yash Gupta'
      AND p.phone IN (v_phone, '7738321817', '917738321817')
  ) THEN
    RAISE EXCEPTION 'Seller identity check failed; Logo Cab Services was not created';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user, 'seller')
  ON CONFLICT (user_id, role) DO NOTHING;

  SELECT id INTO v_seller
  FROM public.seller_profiles
  WHERE user_id = v_user
    AND primary_group = 'travel'
  LIMIT 1;

  IF v_seller IS NULL THEN
    INSERT INTO public.seller_profiles (
      user_id, business_name, description, categories, primary_group,
      society_id, latitude, longitude, store_location_label,
      delivery_radius_km, sell_beyond_community, is_available, vacation_mode,
      verification_status, is_featured, fulfillment_mode,
      availability_start, availability_end, operating_days,
      profile_image_url, cover_image_url, default_action_type
    ) VALUES (
      v_user,
      'Logo Cab Services',
      'Your Journey, Our Responsibility. Bangalore cab services for Shriram Greenfield residents and nearby travellers. Airport transfers, local packages, sightseeing, outstation trips, self-drive rental and driver on hire.'
      || E'\n\n'
      || 'Highlights: Hindi-speaking professional drivers, clean vehicles, comfortable rides, on-time service, water bottle provided, 24/7 airport transfers advertised.'
      || E'\n\n'
      || 'Currently advertised: Flat 10% off for eligible SRGF residents, senior citizens and group travellers during Durga Puja and Navratri. Confirm dates and eligibility with the seller. Prices on listings are indicative. Final fare, inclusions, tolls, parking, extra km or extra hours are confirmed by the seller. Contacting the seller creates an enquiry, not a confirmed booking.',
      ARRAY['airport_transfers', 'local_trips', 'sightseeing', 'outstation', 'self_drive', 'driver_hire']::text[],
      'travel',
      v_society, v_lat, v_lng, 'Shriram Greenfield, Bengaluru',
      10, true, true, false,
      'approved', true, 'self_pickup',
      '00:00:00', '23:59:00',
      ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']::text[],
      v_profile, v_cover, 'contact_seller'
    )
    RETURNING id INTO v_seller;
  ELSE
    UPDATE public.seller_profiles
    SET
      business_name = 'Logo Cab Services',
      description = 'Your Journey, Our Responsibility. Bangalore cab services for Shriram Greenfield residents and nearby travellers. Airport transfers, local packages, sightseeing, outstation trips, self-drive rental and driver on hire.'
        || E'\n\n'
        || 'Highlights: Hindi-speaking professional drivers, clean vehicles, comfortable rides, on-time service, water bottle provided, 24/7 airport transfers advertised.'
        || E'\n\n'
        || 'Currently advertised: Flat 10% off for eligible SRGF residents, senior citizens and group travellers during Durga Puja and Navratri. Confirm dates and eligibility with the seller. Prices on listings are indicative. Final fare, inclusions, tolls, parking, extra km or extra hours are confirmed by the seller. Contacting the seller creates an enquiry, not a confirmed booking.',
      categories = ARRAY['airport_transfers', 'local_trips', 'sightseeing', 'outstation', 'self_drive', 'driver_hire']::text[],
      society_id = v_society,
      latitude = v_lat,
      longitude = v_lng,
      store_location_label = 'Shriram Greenfield, Bengaluru',
      delivery_radius_km = 10,
      sell_beyond_community = true,
      is_available = true,
      vacation_mode = false,
      verification_status = 'approved',
      is_featured = true,
      fulfillment_mode = 'self_pickup',
      availability_start = '00:00:00',
      availability_end = '23:59:00',
      operating_days = ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']::text[],
      profile_image_url = v_profile,
      cover_image_url = v_cover,
      default_action_type = 'contact_seller',
      updated_at = now()
    WHERE id = v_seller;
  END IF;

  INSERT INTO public.seller_credit_accounts (
    seller_id, available, reserved, lifetime_purchased, lifetime_consumed,
    lifetime_adjusted, last_health, updated_at
  )
  VALUES (v_seller, 500, 0, 0, 0, 500, 'healthy', now())
  ON CONFLICT (seller_id) DO UPDATE
  SET
    available = CASE
      WHEN seller_credit_accounts.available > 0 THEN seller_credit_accounts.available
      ELSE 500
    END,
    last_health = CASE
      WHEN seller_credit_accounts.available > 0 THEN seller_credit_accounts.last_health
      ELSE 'healthy'
    END,
    lifetime_adjusted = CASE
      WHEN seller_credit_accounts.available > 0 THEN seller_credit_accounts.lifetime_adjusted
      ELSE 500
    END,
    updated_at = now();

  IF NOT EXISTS (
    SELECT 1
    FROM public.seller_credit_ledger
    WHERE seller_id = v_seller
      AND type = 'admin_adjustment'
      AND metadata->>'request_id' = 'onboard-logo-cab-500'
  ) AND EXISTS (
    SELECT 1
    FROM public.seller_credit_accounts
    WHERE seller_id = v_seller
      AND available >= 500
  ) THEN
    INSERT INTO public.seller_credit_ledger (
      seller_id, type, amount, configured_price, charged_amount, balance_after,
      reference_type, description, created_by, metadata
    )
    SELECT
      v_seller,
      'admin_adjustment',
      500,
      500,
      500,
      a.available,
      'admin_adjustment',
      'Onboarding Sociva credit for Logo Cab Services',
      v_user,
      jsonb_build_object('request_id', 'onboard-logo-cab-500', 'direction', 'add')
    FROM public.seller_credit_accounts a
    WHERE a.seller_id = v_seller;
  END IF;

  INSERT INTO public.products (
    id, seller_id, name, description, price, category, action_type, listing_type,
    image_url, is_available, is_veg, approval_status, contact_phone, tags,
    bullet_features, specifications, service_duration_minutes, delivery_time_text
  )
  VALUES
    (
      'cabb7738-2181-4001-8001-9cfb9f6b7110', v_seller,
      'Standard Airport Transfer',
      'Advertised starting price Rs 600. Exact route, vehicle and inclusions must be confirmed by the seller. Share pickup location, airport or destination, date, time, passengers and luggage when you contact.',
      600, 'airport_transfers', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1436491865332-7a61a1093801?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['airport', 'cab', 'bangalore', 'transfer']::text[],
      ARRAY['Starting Rs 600', 'Exact fare confirmed by seller', 'Share pickup, airport, date and time']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Pricing', 'Starting Rs 600. Not a guaranteed final fare.',
            'Ask the seller', 'Pickup, airport or destination, date, time, passengers, luggage, one-way or return.',
            'Service area', 'Bangalore airport transfers'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, '24/7 advertised'
    ),
    (
      'cabb7738-2181-4002-8001-9cfb9f6b7110', v_seller,
      'Luxury Comfort Airport Transfer',
      'Advertised starting price Rs 999. Exact route, vehicle and inclusions must be confirmed by the seller. Share pickup, airport, date, time, passengers and luggage when you contact.',
      999, 'airport_transfers', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['airport', 'luxury', 'innova', 'cab']::text[],
      ARRAY['Starting Rs 999', 'Luxury comfort advertised', 'Exact fare confirmed by seller']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Pricing', 'Starting Rs 999. Not a guaranteed final fare.',
            'Ask the seller', 'Pickup, airport or destination, date, time, passengers, luggage, preferred vehicle.',
            'Service area', 'Bangalore airport transfers'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, '24/7 advertised'
    ),
    (
      'cabb7738-2181-4003-8001-9cfb9f6b7110', v_seller,
      'Shared Airport Transfer',
      'Sharing rides are advertised on airport transfers. No shared-ride price is listed on the flyer. Availability and fare must be confirmed by the seller. Do not assume a matching passenger.',
      0, 'airport_transfers', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['airport', 'shared', 'carpool']::text[],
      ARRAY['Contact seller for a quote', 'Availability confirmed by seller', 'Share pickup, destination, date and time']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Pricing', 'Contact seller for a quote. No shared-ride price was advertised.',
            'Ask the seller', 'Pickup, destination, date, time, passengers and willingness to share.',
            'Note', 'Seller must confirm the shared ride before it is treated as available.'
          ))
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4004-8001-9cfb9f6b7110', v_seller,
      'Local City Trip - 4 Hours / 40 KM',
      'Advertised Bangalore local package Rs 1,500 for 4 hours and 40 km. Extra-hour and extra-kilometre charges must be confirmed by the seller. Share start location, date, pickup time, passengers and sightseeing stops.',
      1500, 'local_trips', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['local', 'bangalore', 'city', 'package']::text[],
      ARRAY['Rs 1,500 advertised package', '4 hours / 40 km included', 'Extra hour and km charges to confirm']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 1,500 for 4 hours / 40 km',
            'Ask the seller', 'Start location, date, pickup time, passengers, stops, preferred vehicle, extra-hour and extra-km charges.',
            'Service area', 'Local Bangalore'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      240, null
    ),
    (
      'cabb7738-2181-4005-8001-9cfb9f6b7110', v_seller,
      'Local City Trip - 8 Hours / 80 KM',
      'Advertised Bangalore local package Rs 3,000 for 8 hours and 80 km. Extra-hour and extra-kilometre charges must be confirmed by the seller. Share start location, date, pickup time, passengers and itinerary.',
      3000, 'local_trips', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['local', 'bangalore', 'city', 'package']::text[],
      ARRAY['Rs 3,000 advertised package', '8 hours / 80 km included', 'Extra hour and km charges to confirm']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 3,000 for 8 hours / 80 km',
            'Ask the seller', 'Start location, date, pickup time, passengers, itinerary, preferred vehicle, extra-hour and extra-km charges.',
            'Service area', 'Local Bangalore'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      480, null
    ),
    (
      'cabb7738-2181-4006-8001-9cfb9f6b7110', v_seller,
      'Nandi Hills Trip',
      'Advertised package price Rs 3,500. Route, included distance, duration, vehicle and whether tolls or parking are included must be confirmed by the seller.',
      3500, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['nandi hills', 'sightseeing', 'bangalore']::text[],
      ARRAY['Rs 3,500 advertised package', 'Route and inclusions to confirm', 'Share date, pickup and passengers']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 3,500',
            'Pending seller confirmation', 'Route, duration, included km, vehicle, tolls, parking, return travel.',
            'Ask the seller', 'Preferred date, pickup location, passengers, vehicle preference.'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4007-8001-9cfb9f6b7110', v_seller,
      'Mysore Trip',
      'Advertised standard package price Rs 8,000. A separate Dussehra promotion is listed as its own service at Rs 7,000. This listing keeps the standard price. Route, duration, vehicle and inclusions must be confirmed by the seller.',
      8000, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1582510003544-4d00b8c73972?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['mysore', 'sightseeing', 'outstation']::text[],
      ARRAY['Rs 8,000 standard advertised package', 'Separate Rs 7,000 Dussehra listing exists', 'Details to confirm with seller']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 8,000 standard',
            'Related offer', 'Mysore Dussehra Round Trip is a separate listing at Rs 7,000 promotional.',
            'Pending seller confirmation', 'Route, duration, included km, vehicle, tolls, parking, return travel.'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4008-8001-9cfb9f6b7110', v_seller,
      'Mysore Dussehra Round Trip - Kia Sonet',
      'Promotional flyer price Rs 7,000 for a Mysore Dussehra round trip in a Kia Sonet luxury SUV. This is not the standard Mysore package (Rs 8,000). Validity dates and inclusions must be confirmed by the seller before travel.',
      7000, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1606664512234-273f8f0da5be?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['mysore', 'dussehra', 'promo', 'kia sonet']::text[],
      ARRAY['Rs 7,000 promotional', 'Kia Sonet luxury SUV advertised', 'Validity dates to confirm']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised offer', 'Rs 7,000 promotional Dussehra round trip',
            'Vehicle advertised', 'Kia Sonet luxury SUV',
            'Note', 'Promotional. Subject to seller confirmation and validity dates. Standard Mysore trip remains Rs 8,000.'
          ))
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4009-8001-9cfb9f6b7110', v_seller,
      'Bannerghatta National Park Trip',
      'Advertised package price Rs 4,000. Route, duration, included distance, vehicle and park tickets must be confirmed by the seller.',
      4000, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1561731216-c3a4d99437d5?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['bannerghatta', 'sightseeing', 'wildlife']::text[],
      ARRAY['Rs 4,000 advertised package', 'Route and inclusions to confirm', 'Share date, pickup and passengers']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 4,000',
            'Pending seller confirmation', 'Route, duration, included km, vehicle, tickets, tolls, parking.',
            'Ask the seller', 'Preferred date, pickup location, passengers, vehicle preference.'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4010-8001-9cfb9f6b7110', v_seller,
      'Kotilingeshwara Temple Trip',
      'Advertised package price Rs 3,900. Route, duration, included distance and vehicle must be confirmed by the seller.',
      3900, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1582510003544-4d00b8c73972?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['kotilingeshwara', 'temple', 'sightseeing']::text[],
      ARRAY['Rs 3,900 advertised package', 'Route and inclusions to confirm', 'Share date, pickup and passengers']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 3,900',
            'Pending seller confirmation', 'Route, duration, included km, vehicle, tolls, parking, return travel.',
            'Ask the seller', 'Preferred date, pickup location, passengers, vehicle preference.'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4011-8001-9cfb9f6b7110', v_seller,
      'Coorg Trip',
      'Advertised package price Rs 9,000. Route, duration, included distance, overnight stay if any, and vehicle must be confirmed by the seller.',
      9000, 'sightseeing', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['coorg', 'sightseeing', 'outstation']::text[],
      ARRAY['Rs 9,000 advertised package', 'Route and inclusions to confirm', 'Share dates, pickup and passengers']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised package', 'Rs 9,000',
            'Pending seller confirmation', 'Route, duration, included km, vehicle, stay, tolls, parking, return travel.',
            'Ask the seller', 'Travel dates, pickup location, passengers, vehicle preference.'
          )),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4012-8001-9cfb9f6b7110', v_seller,
      'General Outstation Trip',
      'Pricing depends on vehicle and distance. The flyer rate card is indicative only. Final fare is confirmed by the seller after trip distance, minimum kilometres, driver allowance, tolls, parking and other charges are known. Share origin, destination, dates, one-way or round trip, passengers and vehicle.',
      0, 'outstation', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['outstation', 'per km', 'cab', 'group']::text[],
      ARRAY['Indicative per-km rate card', 'Final fare confirmed by seller', 'Share origin, destination and dates']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Pricing', 'Final fare confirmed by seller. Do not treat the rate card as a guaranteed fare.',
            'Pending confirmation', 'Minimum billable km, night charges, tolls, parking, interstate permits, taxes, waiting charges, driver allowance basis.',
            'Ask the seller', 'Origin, destination, travel date, return date if needed, passengers, luggage, one-way or round trip, stops, vehicle.'
          )),
          jsonb_build_object('type', 'size_chart', 'data', v_rate_card),
          jsonb_build_object('type', 'variants', 'data', v_vehicle_options)
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4013-8001-9cfb9f6b7110', v_seller,
      'Shared Outstation Ride / Carpooling',
      'Sharing rides and carpooling are advertised for outstation trips. No shared-ride price is listed. Availability is not promised. The seller must confirm the shared ride before it is treated as available.',
      0, 'outstation', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1489824904134-891ab64532f1?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['outstation', 'shared', 'carpool']::text[],
      ARRAY['Contact seller for a quote', 'Availability confirmed by seller', 'Share origin, destination and date']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Pricing', 'Contact seller for a quote.',
            'Ask the seller', 'Origin, destination, date, preferred departure time, passenger count, luggage.',
            'Note', 'Do not promise a matching passenger. Seller confirmation required.'
          ))
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4014-8001-9cfb9f6b7110', v_seller,
      'Kia Sonet Self-Drive Rental',
      'Advertised starting price Rs 2,500 for a Kia Sonet automatic petrol 2024 model. The flyer does not say whether this is per day. Rental duration, deposit, kilometres included, fuel policy, documents, availability and final price must be confirmed by the seller.',
      2500, 'self_drive', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1606664512234-273f8f0da5be?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['self drive', 'kia sonet', 'rental']::text[],
      ARRAY['Starting Rs 2,500', 'Rental period to be confirmed', 'Availability confirmed by seller']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Vehicle advertised', 'Kia Sonet, automatic, petrol, 2024 model',
            'Pricing', 'Starting Rs 2,500. Billing period is unspecified until the seller confirms.',
            'Must confirm', 'Rental duration, deposit, kilometres included, fuel policy, documents, final price and date availability.',
            'Ask the seller', 'Start date/time, return date/time, pickup location, duration, eligibility.'
          ))
        )
      ),
      null, null
    ),
    (
      'cabb7738-2181-4015-8001-9cfb9f6b7110', v_seller,
      'Local Driver on Hire - 4 Hours',
      'Advertised price Rs 800 for 4 hours. Extra-hour charges and kilometre limits must be confirmed. The seller should confirm whether this is driver only or includes a cab.',
      800, 'driver_hire', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1449965408869-eaa3f349e98f?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['driver', 'local', 'hire']::text[],
      ARRAY['Rs 800 advertised for 4 hours', 'Confirm if vehicle is included', 'Extra hours to confirm']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised price', 'Rs 800 for 4 hours local',
            'Pending confirmation', 'Extra-hour charges, kilometre limits, whether the customer provides the vehicle.',
            'Ask the seller', 'Service date, start time, pickup location, duration, vehicle type, who provides the vehicle.'
          ))
        )
      ),
      240, null
    ),
    (
      'cabb7738-2181-4016-8001-9cfb9f6b7110', v_seller,
      'Outstation Driver on Hire - 4 Hours',
      'Advertised price Rs 1,200 for 4 hours outstation. This duration and price combination should be verified with the seller before treating it as a definitive package. Confirm whether this is driver only or includes a cab.',
      1200, 'driver_hire', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['driver', 'outstation', 'hire']::text[],
      ARRAY['Rs 1,200 advertised for 4 hours', 'Verify duration and inclusions', 'Confirm if vehicle is included']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised price', 'Rs 1,200 for 4 hours outstation',
            'Verification needed', 'Duration and pricing combination flagged for seller confirmation. Confirm driver-only vs cab included.',
            'Ask the seller', 'Date, start time, pickup location, destination, duration, who provides the vehicle.'
          ))
        )
      ),
      240, null
    ),
    (
      'cabb7738-2181-4017-8001-9cfb9f6b7110', v_seller,
      'Outstation Driver on Hire - 8 Hours',
      'Advertised price Rs 1,800 for 8 hours outstation. Verify price, duration and whether this is driver only or includes a cab before treating it as a definitive package.',
      1800, 'driver_hire', 'contact_seller', 'service',
      'https://images.unsplash.com/photo-1471478331149-c72f17e33dd7?auto=format&fit=crop&w=1200&q=80',
      true, null, 'approved', v_phone,
      ARRAY['driver', 'outstation', 'hire']::text[],
      ARRAY['Rs 1,800 advertised for 8 hours', 'Verify duration and inclusions', 'Confirm if vehicle is included']::text[],
      jsonb_build_object(
        'blocks', jsonb_build_array(
          jsonb_build_object('type', 'details', 'data', jsonb_build_object(
            'Advertised price', 'Rs 1,800 for 8 hours outstation',
            'Verification needed', 'Price and duration flagged for seller confirmation. Confirm driver-only vs cab included.',
            'Ask the seller', 'Date, start time, pickup location, destination, duration, who provides the vehicle.'
          ))
        )
      ),
      480, null
    )
  ON CONFLICT (id) DO UPDATE
  SET
    seller_id = EXCLUDED.seller_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    category = EXCLUDED.category,
    action_type = EXCLUDED.action_type,
    listing_type = EXCLUDED.listing_type,
    image_url = EXCLUDED.image_url,
    is_available = true,
    is_veg = null,
    approval_status = 'approved',
    contact_phone = EXCLUDED.contact_phone,
    tags = EXCLUDED.tags,
    bullet_features = EXCLUDED.bullet_features,
    specifications = EXCLUDED.specifications,
    service_duration_minutes = EXCLUDED.service_duration_minutes,
    delivery_time_text = EXCLUDED.delivery_time_text,
    updated_at = now();
END $$;
