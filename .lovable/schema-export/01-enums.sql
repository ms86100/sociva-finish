-- ============================================================
-- Section 1: Custom Enum Types
-- Generated: 2026-03-12
-- ============================================================

CREATE TYPE public.order_status AS ENUM (
  'placed', 'accepted', 'preparing', 'ready', 'picked_up',
  'delivered', 'completed', 'cancelled', 'enquired', 'quoted',
  'scheduled', 'in_progress', 'returned', 'on_the_way', 'arrived',
  'assigned', 'requested', 'confirmed', 'rescheduled', 'no_show'
);

CREATE TYPE public.product_category AS ENUM (
  'home_food', 'bakery', 'snacks', 'groceries', 'other'
);

CREATE TYPE public.seller_type_enum AS ENUM (
  'society_resident', 'commercial'
);

CREATE TYPE public.service_category AS ENUM (
  'home_food', 'bakery', 'snacks', 'groceries', 'beverages',
  'tuition', 'daycare', 'coaching', 'yoga', 'dance', 'music',
  'art_craft', 'language', 'fitness', 'electrician', 'plumber',
  'carpenter', 'ac_service', 'pest_control', 'appliance_repair',
  'maid', 'cook', 'driver', 'nanny', 'tailoring', 'laundry',
  'beauty', 'mehendi', 'salon', 'tax_consultant', 'it_support',
  'tutoring', 'resume_writing', 'equipment_rental', 'vehicle_rental',
  'party_supplies', 'baby_gear', 'furniture', 'electronics', 'books',
  'toys', 'kitchen', 'clothing', 'catering', 'decoration',
  'photography', 'dj_music', 'pet_food', 'pet_grooming',
  'pet_sitting', 'dog_walking', 'flat_rent', 'roommate', 'parking'
);

CREATE TYPE public.user_role AS ENUM (
  'buyer', 'seller', 'admin', 'security_officer'
);

CREATE TYPE public.verification_status AS ENUM (
  'pending', 'approved', 'rejected', 'suspended', 'draft'
);
