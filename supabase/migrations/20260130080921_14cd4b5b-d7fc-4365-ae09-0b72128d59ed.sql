-- Phase 2 Database Enhancements

-- Add new order statuses
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'picked_up';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'delivered';

-- Add profile photo to seller_profiles
ALTER TABLE public.seller_profiles 
ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS operating_days TEXT[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

-- Add bestseller/recommended flags to products
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT false;

-- Create favorites table
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  seller_id UUID REFERENCES public.seller_profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, seller_id)
);

-- Enable RLS on favorites
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Favorites policies
CREATE POLICY "Users can view their own favorites"
ON public.favorites FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can add favorites"
ON public.favorites FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove favorites"
ON public.favorites FOR DELETE
USING (user_id = auth.uid());

-- Add review moderation fields
ALTER TABLE public.reviews
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- Create featured_categories table for admin
CREATE TABLE IF NOT EXISTS public.featured_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('seller', 'category', 'banner')),
  reference_id TEXT NOT NULL,
  title TEXT,
  image_url TEXT,
  link_url TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on featured_items
ALTER TABLE public.featured_items ENABLE ROW LEVEL SECURITY;

-- Featured items policies (public read, admin write)
CREATE POLICY "Anyone can view active featured items"
ON public.featured_items FOR SELECT
USING (is_active = true OR public.is_admin(auth.uid()));

CREATE POLICY "Only admins can manage featured items"
ON public.featured_items FOR ALL
USING (public.is_admin(auth.uid()));

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_seller_id ON public.favorites(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON public.products(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON public.orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON public.orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);

-- Update reviews policy to exclude hidden reviews for non-admins
DROP POLICY IF EXISTS "Anyone can view reviews" ON public.reviews;
CREATE POLICY "Anyone can view non-hidden reviews"
ON public.reviews FOR SELECT
USING (is_hidden = false OR public.is_admin(auth.uid()) OR buyer_id = auth.uid());