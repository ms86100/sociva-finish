-- Puja & Devotional parent group for agarbatti, dhoop, and puja samagri.
-- Contact-seller by default. Idempotent so other environments can apply it.
-- Moves SanataniDhara off Other Food & Beverages when that store is present.

INSERT INTO public.parent_groups (
  slug, name, icon, color, description, sort_order, is_active, layout_type,
  requires_license, license_mandatory
)
VALUES (
  'puja',
  'Puja & Devotional',
  '🪔',
  'bg-amber-100 text-amber-700',
  'Agarbatti, dhoop, puja samagri and divine essentials',
  8,
  true,
  'ecommerce',
  false,
  false
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
  supports_warranty_display, seller_domain
)
VALUES
  (
    'agarbatti', 'Agarbatti & Dhoop', '🪔', 'bg-amber-100 text-amber-700', 'puja', 'grid',
    'Contact Seller', false, false, true,
    true, false, false, null, false,
    false, false, false, false,
    false, false, null, 'contact_enquiry', 1,
    true, 'popular',
    'e.g. Royal Rose Agarbatti',
    'Fragrance, burn time, and how it is used for puja',
    'Price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'diya', false, false,
    '1:1', 'cover', true, false, 'listing'
  ),
  (
    'puja_samagri', 'Puja Samagri', '🌸', 'bg-amber-100 text-amber-700', 'puja', 'grid',
    'Contact Seller', false, false, true,
    true, false, false, null, false,
    false, false, false, false,
    false, false, null, 'contact_enquiry', 2,
    true, 'popular',
    'e.g. Festival puja kit',
    'What is included and when it is used',
    'Price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'flower', false, false,
    '1:1', 'cover', false, false, 'listing'
  ),
  (
    'other-puja', 'Other Puja & Devotional', '✨', 'bg-amber-100 text-amber-700', 'puja', 'grid',
    'Contact Seller', false, false, true,
    false, false, false, null, false,
    false, false, false, false,
    false, false, null, 'contact_enquiry', 9999,
    true, 'popular',
    'e.g. Devotional offering',
    'Describe this puja or devotional item',
    'Price',
    false, 'contact_seller', null, false,
    false, false, false,
    null, 'sparkle', false, false,
    '1:1', 'cover', false, false, 'listing'
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
  supports_cart = EXCLUDED.supports_cart,
  transaction_type = EXCLUDED.transaction_type,
  default_action_type = EXCLUDED.default_action_type,
  seller_domain = EXCLUDED.seller_domain,
  name_placeholder = EXCLUDED.name_placeholder,
  description_placeholder = EXCLUDED.description_placeholder,
  placeholder_emoji = EXCLUDED.placeholder_emoji,
  is_active = true,
  updated_at = now();

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT cc.id, action.action_type
FROM public.category_config cc
CROSS JOIN (VALUES ('contact_seller'), ('request_service')) AS action(action_type)
WHERE cc.category IN ('agarbatti', 'puja_samagri', 'other-puja')
ON CONFLICT (category_config_id, action_type) DO NOTHING;

-- Rehome the pending incense subcategory from inactive resale onto Agarbatti.
UPDATE public.subcategories s
SET
  category_config_id = cc.id,
  display_name = 'Agarbatti & Dhoop Sticks',
  is_active = true,
  review_status = 'approved',
  updated_at = now()
FROM public.category_config cc
WHERE s.slug = 'agarbatti-dhoop-sticks'
  AND cc.category = 'agarbatti';

INSERT INTO public.subcategories (
  category_config_id, slug, display_name, display_order, icon, is_active, origin, review_status
)
SELECT cc.id, v.slug, v.display_name, v.display_order, v.icon, true, 'system', 'approved'
FROM public.category_config cc
CROSS JOIN (
  VALUES
    ('agarbatti', 'agarbatti-dhoop-sticks', 'Agarbatti & Dhoop Sticks', 1, '🪔'),
    ('agarbatti', 'puja_festival_incense_packs', 'Festival Packs', 2, '🎉'),
    ('agarbatti', 'puja_long_burn_sticks', 'Long Burning Sticks', 3, '🕯️'),
    ('puja_samagri', 'puja_diya_and_lamps', 'Diya & Lamps', 1, '🪔'),
    ('puja_samagri', 'puja_flowers_and_garlands', 'Flowers & Garlands', 2, '🌸'),
    ('puja_samagri', 'puja_kumkum_and_camphor', 'Kumkum & Camphor', 3, '🧡')
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
  'puja',
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
    WHERE existing.parent_group = 'puja'
      AND existing.transaction_type = 'contact_enquiry'
      AND existing.status_key = d.status_key
  );

INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status,
  allowed_actor, allowed_roles, is_side_action, display_label
)
SELECT
  'puja',
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
  WHERE t.parent_group = 'puja'
    AND t.transaction_type = 'contact_enquiry'
    AND t.from_status = x.from_status
    AND t.to_status = x.to_status
);

-- SanataniDhara: leave other environments unchanged if this store is absent.
UPDATE public.seller_profiles sp
SET
  primary_group = 'puja',
  categories = ARRAY['agarbatti']::text[],
  default_action_type = 'contact_seller',
  subcategory_preferences = jsonb_build_object(
    'v', 1,
    'data', jsonb_build_object(
      cc.id::text, jsonb_build_object(
        'others', '[]'::jsonb,
        'primary', sub.id,
        'customLabel', null
      )
    )
  ),
  updated_at = now()
FROM public.category_config cc
JOIN public.subcategories sub
  ON sub.category_config_id = cc.id
 AND sub.slug = 'agarbatti-dhoop-sticks'
WHERE sp.id = 'ff37b5d7-656c-493a-b5ab-ab228dc427c1'
  AND sp.business_name = 'SanataniDhara'
  AND cc.category = 'agarbatti';

UPDATE public.products
SET category = 'agarbatti'
WHERE seller_id = 'ff37b5d7-656c-493a-b5ab-ab228dc427c1'
  AND category = 'other-food_beverages'
  AND EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = 'ff37b5d7-656c-493a-b5ab-ab228dc427c1'
      AND sp.business_name = 'SanataniDhara'
  );
