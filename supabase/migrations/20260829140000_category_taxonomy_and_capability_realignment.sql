-- ============================================================================
-- Migration: 20260829140000_category_taxonomy_and_capability_realignment.sql
-- Description: Clean, logically reorganize categories/subcategories, fix
--              misplacements (Ayurveda -> Health, Daycare -> Domestic Help & Care),
--              fix furniture license, and populate category_allowed_action_types.
-- ============================================================================

-- 0. Extend validate_transaction_type to include contact_enquiry
CREATE OR REPLACE FUNCTION public.validate_transaction_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ 
BEGIN 
  IF NEW.transaction_type IS NOT NULL AND NEW.transaction_type NOT IN (
    'cart_purchase', 'self_fulfillment', 'seller_delivery', 'request_service', 
    'book_slot', 'enquiry_only', 'service_booking', 'subscription', 'contact_enquiry'
  ) THEN 
    RAISE EXCEPTION 'Invalid transaction_type: %', NEW.transaction_type; 
  END IF; 
  RETURN NEW; 
END; 
$function$;

-- 1. Clean and organize parent_groups
UPDATE public.parent_groups
SET is_active = false
WHERE slug IN ('food', 'classes', 'services', 'personal', 'test', 'hello_section');

UPDATE public.parent_groups SET sort_order = 1, name = 'Food & Beverages', icon = '🍲', is_active = true WHERE slug = 'food_beverages';
UPDATE public.parent_groups SET sort_order = 2, name = 'Home Services & Repairs', icon = '🔧', is_active = true WHERE slug = 'home_services';
UPDATE public.parent_groups SET sort_order = 3, name = 'Personal Care & Salon', icon = '💅', is_active = true WHERE slug = 'personal_care';
UPDATE public.parent_groups SET sort_order = 4, name = 'Health, Medical & Ayurveda', icon = '🩺', is_active = true, requires_license = true, license_mandatory = true, license_type_name = 'Medical Registration / Practice License', license_description = 'Valid medical council / AYUSH practice registration required.' WHERE slug = 'health';
UPDATE public.parent_groups SET sort_order = 5, name = 'Domestic Help & Care', icon = '🏠', is_active = true WHERE slug = 'domestic_help';
UPDATE public.parent_groups SET sort_order = 6, name = 'Education & Learning', icon = '📚', is_active = true WHERE slug = 'education_learning';
UPDATE public.parent_groups SET sort_order = 7, name = 'Pet Services & Supplies', icon = '🐕', is_active = true WHERE slug = 'pets';
UPDATE public.parent_groups SET sort_order = 8, name = 'Events & Catering', icon = '🎉', is_active = true WHERE slug = 'events';
UPDATE public.parent_groups SET sort_order = 9, name = 'Rentals & Borrowing', icon = '🚲', is_active = true WHERE slug = 'rentals';
UPDATE public.parent_groups SET sort_order = 10, name = 'Buy & Sell (Pre-loved & New)', icon = '📦', is_active = true WHERE slug = 'resale';
UPDATE public.parent_groups SET sort_order = 11, name = 'Property & Parking', icon = '🏢', is_active = true WHERE slug = 'property';
UPDATE public.parent_groups SET sort_order = 12, name = 'Professional Help', icon = '💼', is_active = true WHERE slug = 'professional';

-- 2. Restructure and Fix Mismatched category_config
-- Ayurveda belongs under health
UPDATE public.category_config
SET parent_group = 'health',
    display_name = 'Ayurveda & Panchakarma',
    icon = '🌿',
    default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    requires_license = true,
    license_type_name = 'Ayurvedic Medical Council Registration',
    license_mandatory = true,
    license_description = 'Valid State Ayurvedic Council or AYUSH registration required.'
WHERE category = 'ayurveda';

-- Daycare belongs under domestic_help
UPDATE public.category_config
SET parent_group = 'domestic_help',
    display_name = 'Daycare & Crèche',
    icon = '👶',
    default_action_type = 'contact_seller',
    transaction_type = 'contact_enquiry',
    supports_cart = false,
    requires_price = false,
    requires_availability = false,
    has_duration = false,
    requires_license = false,
    license_type_name = null,
    license_mandatory = false
WHERE category = 'daycare';

-- Fix Furniture license bug
UPDATE public.category_config
SET requires_license = false,
    license_mandatory = false,
    license_type_name = null,
    license_description = null,
    default_action_type = 'add_to_cart',
    transaction_type = 'cart_purchase',
    supports_cart = true
WHERE category = 'furniture';

-- Fix Pet Food
UPDATE public.category_config
SET requires_license = false,
    license_mandatory = false,
    license_type_name = null,
    license_description = null,
    default_action_type = 'add_to_cart',
    transaction_type = 'cart_purchase',
    supports_cart = true
WHERE category = 'pet_food';

-- 3. Set Action Types and Defaults on all categories
-- Food & Groceries (Cart)
UPDATE public.category_config
SET default_action_type = 'add_to_cart',
    transaction_type = 'cart_purchase',
    supports_cart = true,
    requires_price = true,
    is_physical_product = true
WHERE category IN ('home_food', 'bakery', 'snacks', 'groceries', 'beverages');

-- Resale (Cart)
UPDATE public.category_config
SET default_action_type = 'add_to_cart',
    transaction_type = 'cart_purchase',
    supports_cart = true,
    requires_price = true,
    is_physical_product = true
WHERE category IN ('electronics', 'books', 'toys', 'kitchen', 'clothing');

-- Home Repairs & Services (Booking)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('electrician', 'plumber', 'carpenter', 'ac_service', 'pest_control', 'appliance_repair');

-- Personal Care & Salon (Booking)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('salon', 'beauty', 'mehendi', 'tailoring', 'laundry');

-- Health (Booking)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('medical_specialist');

-- Education & Learning (Booking)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('tuition', 'yoga', 'dance', 'music', 'art_craft', 'language', 'fitness', 'coaching');

-- Pets (Booking for services)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('pet_grooming', 'dog_walking', 'pet_sitting');

-- Domestic Help & Staff (Contact)
UPDATE public.category_config
SET default_action_type = 'contact_seller',
    transaction_type = 'contact_enquiry',
    supports_cart = false,
    requires_price = false,
    requires_availability = false,
    has_duration = false,
    is_physical_product = false
WHERE category IN ('maid', 'cook', 'driver', 'nanny', 'other-domestic_help');

-- Property (Contact)
UPDATE public.category_config
SET default_action_type = 'contact_seller',
    transaction_type = 'contact_enquiry',
    supports_cart = false,
    requires_price = true,
    requires_availability = false,
    has_duration = false,
    is_physical_product = false
WHERE category IN ('flat_rent', 'roommate', 'parking', 'other-property');

-- Events (Enquiry / Request Service)
UPDATE public.category_config
SET default_action_type = 'request_service',
    transaction_type = 'request_service',
    supports_cart = false,
    requires_price = true,
    requires_availability = false,
    has_duration = true,
    is_physical_product = false
WHERE category IN ('catering', 'decoration', 'photography', 'dj_music', 'other-events');

-- Rentals (Booking / Rent)
UPDATE public.category_config
SET default_action_type = 'book',
    transaction_type = 'service_booking',
    supports_cart = false,
    requires_price = true,
    requires_availability = true,
    has_duration = false,
    is_physical_product = true
WHERE category IN ('equipment_rental', 'vehicle_rental', 'party_supplies', 'baby_gear', 'other-rentals');

-- Professional (Enquiry / Request Service)
UPDATE public.category_config
SET default_action_type = 'request_service',
    transaction_type = 'request_service',
    supports_cart = false,
    requires_price = false,
    requires_availability = false,
    has_duration = false,
    is_physical_product = false
WHERE category IN ('tax_consultant', 'it_support', 'tutoring', 'resume_writing', 'other-professional');

-- Deactivate legacy duplicate categories
UPDATE public.category_config SET is_active = false WHERE category IN ('other-classes', 'other-services', 'other-personal', 'other-food');

-- 4. Repopulate category_allowed_action_types
DELETE FROM public.category_allowed_action_types;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'add_to_cart' FROM public.category_config WHERE supports_cart = true
UNION
SELECT id, 'buy_now' FROM public.category_config WHERE supports_cart = true;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'book' FROM public.category_config WHERE default_action_type = 'book'
UNION
SELECT id, 'request_service' FROM public.category_config WHERE default_action_type = 'book'
UNION
SELECT id, 'contact_seller' FROM public.category_config WHERE default_action_type = 'book'
ON CONFLICT DO NOTHING;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'contact_seller' FROM public.category_config WHERE default_action_type = 'contact_seller'
UNION
SELECT id, 'request_service' FROM public.category_config WHERE default_action_type = 'contact_seller'
ON CONFLICT DO NOTHING;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'request_service' FROM public.category_config WHERE default_action_type = 'request_service'
UNION
SELECT id, 'request_quote' FROM public.category_config WHERE default_action_type = 'request_service'
UNION
SELECT id, 'contact_seller' FROM public.category_config WHERE default_action_type = 'request_service'
ON CONFLICT DO NOTHING;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'schedule_visit' FROM public.category_config WHERE parent_group = 'property'
UNION
SELECT id, 'make_offer' FROM public.category_config WHERE parent_group = 'property'
ON CONFLICT DO NOTHING;

INSERT INTO public.category_allowed_action_types (category_config_id, action_type)
SELECT id, 'rent_item' FROM public.category_config WHERE parent_group = 'rentals'
ON CONFLICT DO NOTHING;
