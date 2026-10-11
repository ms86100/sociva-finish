-- Split two food sellers into their own cart categories, and move one clothing
-- seller onto the existing contact flow. Prices, images, stock, and orders stay.

INSERT INTO public.category_config (
  category, display_name, icon, color, parent_group, layout_type,
  primary_button_label, requires_price, is_negotiable, is_physical_product,
  has_quantity, requires_availability, has_duration, duration_label, has_date_range,
  requires_delivery, show_veg_toggle, requires_preparation, requires_time_slot,
  enquiry_only, supports_cart, review_dimensions, transaction_type, display_order,
  is_active, default_sort, name_placeholder, description_placeholder, price_label,
  show_duration_field, default_action_type, lead_time_hours, accepts_preorders,
  preorder_cutoff_time, supports_addons, supports_recurring, supports_staff_assignment,
  price_prefix, placeholder_emoji, requires_license, license_type_name,
  license_mandatory, license_description, image_aspect_ratio, image_object_fit,
  supports_brand_display, supports_warranty_display, seller_domain
)
SELECT
  v.category, v.display_name, src.icon, src.color, src.parent_group, src.layout_type,
  src.primary_button_label, src.requires_price, src.is_negotiable, src.is_physical_product,
  src.has_quantity, src.requires_availability, src.has_duration, src.duration_label, src.has_date_range,
  src.requires_delivery, src.show_veg_toggle, src.requires_preparation, src.requires_time_slot,
  src.enquiry_only, src.supports_cart, src.review_dimensions, src.transaction_type, v.display_order,
  src.is_active, src.default_sort, src.name_placeholder, src.description_placeholder, src.price_label,
  src.show_duration_field, src.default_action_type, src.lead_time_hours, src.accepts_preorders,
  src.preorder_cutoff_time, src.supports_addons, src.supports_recurring, src.supports_staff_assignment,
  src.price_prefix, v.placeholder_emoji, src.requires_license, src.license_type_name,
  src.license_mandatory, src.license_description, src.image_aspect_ratio, src.image_object_fit,
  src.supports_brand_display, src.supports_warranty_display, src.seller_domain
FROM public.category_config src
CROSS JOIN (
  VALUES
    ('cafes_coffee', 'Cafes & Coffee', 6, 'coffee'),
    ('pickles', 'Pickles', 7, 'pickle')
) AS v(category, display_name, display_order, placeholder_emoji)
WHERE src.category = 'home_food'
ON CONFLICT (category) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.seller_profiles
    WHERE (id = '0a670c2b-f28a-4916-90cf-47fb1e9edbfa' AND business_name = 'Mountain High Studio Cafe')
       OR (id = '63cc42c4-4704-48dc-ad7b-2eeeae42c70e' AND business_name LIKE 'MOM%HOME PICKLE')
       OR (id = '84e3f5d2-0bc1-4791-bccd-104f6c2f62af' AND business_name = 'Saha Bastralaya')
  ) <> 3 THEN
    RAISE EXCEPTION 'Seller identity check failed; no catalogue was changed';
  END IF;
END $$;

UPDATE public.seller_profiles
SET categories = array_replace(categories, 'home_food', 'cafes_coffee')
WHERE id = '0a670c2b-f28a-4916-90cf-47fb1e9edbfa'
  AND business_name = 'Mountain High Studio Cafe';

UPDATE public.seller_profiles
SET categories = array_replace(categories, 'home_food', 'pickles')
WHERE id = '63cc42c4-4704-48dc-ad7b-2eeeae42c70e'
  AND business_name LIKE 'MOM%HOME PICKLE';

UPDATE public.products
SET category = 'cafes_coffee'
WHERE seller_id = '0a670c2b-f28a-4916-90cf-47fb1e9edbfa'
  AND category = 'home_food';

UPDATE public.products
SET category = 'pickles'
WHERE seller_id = '63cc42c4-4704-48dc-ad7b-2eeeae42c70e'
  AND category = 'home_food';

UPDATE public.seller_profiles
SET default_action_type = 'contact_seller'
WHERE id = '84e3f5d2-0bc1-4791-bccd-104f6c2f62af'
  AND business_name = 'Saha Bastralaya';

UPDATE public.products
SET action_type = 'contact_seller'
WHERE seller_id = '84e3f5d2-0bc1-4791-bccd-104f6c2f62af'
  AND category = 'clothing'
  AND action_type = 'add_to_cart';
