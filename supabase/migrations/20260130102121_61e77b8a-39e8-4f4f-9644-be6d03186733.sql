-- Create new ENUM for all service categories
CREATE TYPE service_category AS ENUM (
  -- Food & Consumption
  'home_food', 'bakery', 'snacks', 'groceries', 'beverages',
  -- Child Services
  'tuition', 'daycare', 'coaching',
  -- Classes & Skills
  'yoga', 'dance', 'music', 'art_craft', 'language', 'fitness',
  -- Home Services
  'electrician', 'plumber', 'carpenter', 'ac_service', 'pest_control', 'appliance_repair',
  -- Domestic Help
  'maid', 'cook', 'driver', 'nanny',
  -- Personal Services
  'tailoring', 'laundry', 'beauty', 'mehendi', 'salon',
  -- Professional Services
  'tax_consultant', 'it_support', 'tutoring', 'resume_writing',
  -- Rentals
  'equipment_rental', 'vehicle_rental', 'party_supplies', 'baby_gear',
  -- Buy & Sell
  'furniture', 'electronics', 'books', 'toys', 'kitchen', 'clothing',
  -- Events
  'catering', 'decoration', 'photography', 'dj_music',
  -- Pet Services
  'pet_food', 'pet_grooming', 'pet_sitting', 'dog_walking',
  -- Property
  'flat_rent', 'roommate', 'parking'
);

-- Category configuration table (admin-manageable)
CREATE TABLE public.category_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category service_category UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  parent_group TEXT NOT NULL,
  
  -- Behavior flags
  is_physical_product BOOLEAN DEFAULT false,
  requires_preparation BOOLEAN DEFAULT false,
  requires_time_slot BOOLEAN DEFAULT false,
  requires_delivery BOOLEAN DEFAULT false,
  supports_cart BOOLEAN DEFAULT false,
  enquiry_only BOOLEAN DEFAULT false,
  has_quantity BOOLEAN DEFAULT true,
  has_duration BOOLEAN DEFAULT false,
  has_date_range BOOLEAN DEFAULT false,
  is_negotiable BOOLEAN DEFAULT false,
  
  -- Display settings
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for category_config
ALTER TABLE public.category_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active categories" ON public.category_config
  FOR SELECT USING (is_active = true OR public.is_admin(auth.uid()));

CREATE POLICY "Only admins can manage categories" ON public.category_config
  FOR ALL USING (public.is_admin(auth.uid()));

-- Extend products table for service/rental/resale support
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS listing_type TEXT DEFAULT 'product';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS service_duration_minutes INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS rental_period_type TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS min_rental_duration INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS max_rental_duration INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_negotiable BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS location_required BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS available_slots JSONB;

-- Extend orders table for booking/rental support
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'purchase';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_time_start TIME;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_time_end TIME;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rental_start_date DATE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rental_end_date DATE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deposit_refunded BOOLEAN DEFAULT false;

-- Add new order statuses for services
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'enquired' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'enquired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'quoted' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'quoted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'scheduled' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'scheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'in_progress' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'in_progress';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'returned' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'returned';
  END IF;
END $$;

-- Admin settings table for API keys
CREATE TABLE public.admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  is_active BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can manage settings" ON public.admin_settings
  FOR ALL USING (public.is_admin(auth.uid()));

-- Seed category_config with initial data
INSERT INTO public.category_config (category, display_name, icon, color, parent_group, is_physical_product, requires_preparation, requires_time_slot, requires_delivery, supports_cart, enquiry_only, has_quantity, has_duration, has_date_range, is_negotiable, display_order) VALUES
-- Food & Groceries (supports cart, requires preparation)
('home_food', 'Home Food', '🍛', 'bg-orange-100 text-orange-600', 'food', true, true, false, true, true, false, true, false, false, false, 1),
('bakery', 'Bakery', '🧁', 'bg-pink-100 text-pink-600', 'food', true, true, false, true, true, false, true, false, false, false, 2),
('snacks', 'Snacks', '🍿', 'bg-yellow-100 text-yellow-600', 'food', true, true, false, true, true, false, true, false, false, false, 3),
('groceries', 'Groceries', '🥬', 'bg-green-100 text-green-600', 'food', true, false, false, true, true, false, true, false, false, false, 4),
('beverages', 'Beverages', '🧃', 'bg-blue-100 text-blue-600', 'food', true, true, false, true, true, false, true, false, false, false, 5),
-- Classes & Learning (requires time slot)
('tuition', 'Tuition', '📚', 'bg-indigo-100 text-indigo-600', 'classes', false, false, true, false, false, false, false, true, false, false, 10),
('yoga', 'Yoga', '🧘', 'bg-purple-100 text-purple-600', 'classes', false, false, true, false, false, false, false, true, false, false, 11),
('dance', 'Dance', '💃', 'bg-pink-100 text-pink-600', 'classes', false, false, true, false, false, false, false, true, false, false, 12),
('music', 'Music', '🎵', 'bg-red-100 text-red-600', 'classes', false, false, true, false, false, false, false, true, false, false, 13),
('art_craft', 'Art & Craft', '🎨', 'bg-amber-100 text-amber-600', 'classes', false, false, true, false, false, false, false, true, false, false, 14),
('language', 'Language', '🗣️', 'bg-teal-100 text-teal-600', 'classes', false, false, true, false, false, false, false, true, false, false, 15),
('fitness', 'Fitness', '💪', 'bg-orange-100 text-orange-600', 'classes', false, false, true, false, false, false, false, true, false, false, 16),
('coaching', 'Coaching', '🎯', 'bg-cyan-100 text-cyan-600', 'classes', false, false, true, false, false, false, false, true, false, false, 17),
('daycare', 'Daycare', '👶', 'bg-rose-100 text-rose-600', 'classes', false, false, true, false, false, false, false, true, false, false, 18),
-- Home Services (requires time slot)
('electrician', 'Electrician', '⚡', 'bg-yellow-100 text-yellow-600', 'services', false, false, true, false, false, false, false, true, false, false, 20),
('plumber', 'Plumber', '🔧', 'bg-blue-100 text-blue-600', 'services', false, false, true, false, false, false, false, true, false, false, 21),
('carpenter', 'Carpenter', '🪚', 'bg-amber-100 text-amber-600', 'services', false, false, true, false, false, false, false, true, false, false, 22),
('ac_service', 'AC Service', '❄️', 'bg-cyan-100 text-cyan-600', 'services', false, false, true, false, false, false, false, true, false, false, 23),
('pest_control', 'Pest Control', '🐜', 'bg-lime-100 text-lime-600', 'services', false, false, true, false, false, false, false, true, false, false, 24),
('appliance_repair', 'Appliance Repair', '🔌', 'bg-slate-100 text-slate-600', 'services', false, false, true, false, false, false, false, true, false, false, 25),
-- Domestic Help (enquiry first)
('maid', 'Maid Service', '🧹', 'bg-violet-100 text-violet-600', 'services', false, false, false, false, false, true, false, false, false, false, 30),
('cook', 'Cook', '👨‍🍳', 'bg-orange-100 text-orange-600', 'services', false, false, false, false, false, true, false, false, false, false, 31),
('driver', 'Driver', '🚗', 'bg-gray-100 text-gray-600', 'services', false, false, false, false, false, true, false, false, false, false, 32),
('nanny', 'Nanny', '👶', 'bg-pink-100 text-pink-600', 'services', false, false, false, false, false, true, false, false, false, false, 33),
-- Personal Services (requires time slot)
('tailoring', 'Tailoring', '🧵', 'bg-fuchsia-100 text-fuchsia-600', 'personal', false, false, true, false, false, false, false, true, false, false, 40),
('laundry', 'Laundry', '👕', 'bg-sky-100 text-sky-600', 'personal', false, false, true, true, false, false, false, false, false, false, 41),
('beauty', 'Beauty', '💄', 'bg-rose-100 text-rose-600', 'personal', false, false, true, false, false, false, false, true, false, false, 42),
('mehendi', 'Mehendi', '🖐️', 'bg-orange-100 text-orange-600', 'personal', false, false, true, false, false, false, false, true, false, false, 43),
('salon', 'Salon', '✂️', 'bg-purple-100 text-purple-600', 'personal', false, false, true, false, false, false, false, true, false, false, 44),
-- Professional Services (enquiry first)
('tax_consultant', 'Tax Consultant', '📊', 'bg-emerald-100 text-emerald-600', 'professional', false, false, false, false, false, true, false, false, false, false, 50),
('it_support', 'IT Support', '💻', 'bg-blue-100 text-blue-600', 'professional', false, false, true, false, false, false, false, true, false, false, 51),
('tutoring', 'Tutoring', '📝', 'bg-indigo-100 text-indigo-600', 'professional', false, false, true, false, false, false, false, true, false, false, 52),
('resume_writing', 'Resume Writing', '📄', 'bg-gray-100 text-gray-600', 'professional', false, false, false, false, false, true, false, false, false, false, 53),
-- Rentals (has date range)
('equipment_rental', 'Equipment', '🔨', 'bg-zinc-100 text-zinc-600', 'rentals', true, false, false, false, false, false, false, false, true, false, 60),
('vehicle_rental', 'Vehicle', '🚲', 'bg-teal-100 text-teal-600', 'rentals', true, false, false, false, false, false, false, false, true, false, 61),
('party_supplies', 'Party Supplies', '🎉', 'bg-pink-100 text-pink-600', 'rentals', true, false, false, false, false, false, false, false, true, false, 62),
('baby_gear', 'Baby Gear', '🍼', 'bg-rose-100 text-rose-600', 'rentals', true, false, false, false, false, false, false, false, true, false, 63),
-- Buy & Sell (negotiable, enquiry only)
('furniture', 'Furniture', '🛋️', 'bg-amber-100 text-amber-600', 'resale', true, false, false, false, false, true, false, false, false, true, 70),
('electronics', 'Electronics', '📱', 'bg-slate-100 text-slate-600', 'resale', true, false, false, false, false, true, false, false, false, true, 71),
('books', 'Books', '📚', 'bg-yellow-100 text-yellow-600', 'resale', true, false, false, false, false, true, false, false, false, true, 72),
('toys', 'Toys', '🧸', 'bg-pink-100 text-pink-600', 'resale', true, false, false, false, false, true, false, false, false, true, 73),
('kitchen', 'Kitchen', '🍳', 'bg-orange-100 text-orange-600', 'resale', true, false, false, false, false, true, false, false, false, true, 74),
('clothing', 'Clothing', '👗', 'bg-purple-100 text-purple-600', 'resale', true, false, false, false, false, true, false, false, false, true, 75),
-- Events
('catering', 'Catering', '🍽️', 'bg-red-100 text-red-600', 'events', false, true, true, true, false, false, false, true, false, false, 80),
('decoration', 'Decoration', '🎀', 'bg-pink-100 text-pink-600', 'events', false, false, true, false, false, false, false, true, false, false, 81),
('photography', 'Photography', '📷', 'bg-gray-100 text-gray-600', 'events', false, false, true, false, false, false, false, true, false, false, 82),
('dj_music', 'DJ & Music', '🎧', 'bg-violet-100 text-violet-600', 'events', false, false, true, false, false, false, false, true, false, false, 83),
-- Pet Services
('pet_food', 'Pet Food', '🦴', 'bg-amber-100 text-amber-600', 'pets', true, true, false, true, true, false, true, false, false, false, 90),
('pet_grooming', 'Pet Grooming', '🐕', 'bg-sky-100 text-sky-600', 'pets', false, false, true, false, false, false, false, true, false, false, 91),
('pet_sitting', 'Pet Sitting', '🏠', 'bg-green-100 text-green-600', 'pets', false, false, true, false, false, false, false, true, true, false, 92),
('dog_walking', 'Dog Walking', '🦮', 'bg-lime-100 text-lime-600', 'pets', false, false, true, false, false, false, false, true, false, false, 93),
-- Property (enquiry only)
('flat_rent', 'Flat for Rent', '🏢', 'bg-indigo-100 text-indigo-600', 'property', false, false, false, false, false, true, false, false, false, true, 100),
('roommate', 'Roommate', '👥', 'bg-teal-100 text-teal-600', 'property', false, false, false, false, false, true, false, false, false, true, 101),
('parking', 'Parking', '🅿️', 'bg-blue-100 text-blue-600', 'property', false, false, false, false, false, true, false, false, false, true, 102);

-- Create updated_at trigger for category_config
CREATE TRIGGER update_category_config_updated_at
  BEFORE UPDATE ON public.category_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Create updated_at trigger for admin_settings
CREATE TRIGGER update_admin_settings_updated_at
  BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();