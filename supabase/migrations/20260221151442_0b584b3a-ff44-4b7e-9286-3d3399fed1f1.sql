
-- ============================================================
-- PHASE 1: Marketplace Gap Closure — Schema Extensions
-- ============================================================

-- 1. Stock Quantity Tracking on Products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT 5;

-- Auto-decrement stock on order placement (via trigger)
CREATE OR REPLACE FUNCTION public.decrement_stock_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only decrement for products that have stock tracking enabled
  UPDATE products
  SET stock_quantity = GREATEST(stock_quantity - NEW.quantity, 0)
  WHERE id = NEW.product_id
    AND stock_quantity IS NOT NULL;

  -- Auto-mark unavailable if stock hits zero
  UPDATE products
  SET is_available = false
  WHERE id = NEW.product_id
    AND stock_quantity IS NOT NULL
    AND stock_quantity <= 0;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_decrement_stock_on_order_item
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.decrement_stock_on_order();

-- 2. Minimum Order Amount per Seller
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric DEFAULT NULL;

-- 3. Subcategories Table
CREATE TABLE IF NOT EXISTS public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_config_id uuid NOT NULL REFERENCES public.category_config(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  display_order integer DEFAULT 0,
  icon text DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_config_id, slug)
);

ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

-- Anyone can read subcategories
CREATE POLICY "Anyone can read subcategories"
  ON public.subcategories FOR SELECT
  USING (true);

-- Only admins can manage subcategories
CREATE POLICY "Admins can manage subcategories"
  ON public.subcategories FOR ALL
  USING (public.is_admin(auth.uid()));

-- Add subcategory reference to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory_id uuid DEFAULT NULL REFERENCES public.subcategories(id);

-- 4. Pre-order / Lead Time Config on category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS lead_time_hours integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepts_preorders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preorder_cutoff_time time DEFAULT NULL;

-- 5. Review Dimensions per Category
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS review_dimensions text[] DEFAULT NULL;

-- 6. Default Sort on category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS default_sort text NOT NULL DEFAULT 'popular';

-- Validate default_sort values
CREATE OR REPLACE FUNCTION public.validate_default_sort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.default_sort NOT IN ('popular', 'price_low', 'price_high', 'newest', 'rating') THEN
    RAISE EXCEPTION 'Invalid default_sort: %. Must be popular, price_low, price_high, newest, or rating', NEW.default_sort;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_default_sort
  BEFORE INSERT OR UPDATE ON public.category_config
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_default_sort();

-- Index for subcategory lookups
CREATE INDEX IF NOT EXISTS idx_subcategories_category_config ON public.subcategories(category_config_id);
CREATE INDEX IF NOT EXISTS idx_products_subcategory ON public.products(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_products_stock ON public.products(stock_quantity) WHERE stock_quantity IS NOT NULL;
