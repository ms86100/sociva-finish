
-- Security definer function to get user's society_id
CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT society_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

-- Coupons table
CREATE TABLE public.coupons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  code text NOT NULL,
  discount_type text NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'flat')),
  discount_value numeric NOT NULL DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  max_discount_amount numeric DEFAULT NULL,
  usage_limit integer DEFAULT NULL,
  times_used integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, code)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Sellers can manage their own coupons
CREATE POLICY "Sellers can manage their own coupons"
ON public.coupons FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.seller_profiles
    WHERE seller_profiles.id = coupons.seller_id
    AND seller_profiles.user_id = auth.uid()
  )
);

-- Buyers can view active coupons in their society
CREATE POLICY "Users can view active coupons in their society"
ON public.coupons FOR SELECT
USING (
  is_active = true
  AND society_id = get_user_society_id(auth.uid())
  AND (expires_at IS NULL OR expires_at > now())
  AND (starts_at <= now())
);

-- Admins can manage all coupons
CREATE POLICY "Admins can manage all coupons"
ON public.coupons FOR ALL
USING (is_admin(auth.uid()));

-- Coupon redemptions table
CREATE TABLE public.coupon_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  discount_applied numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own redemptions"
ON public.coupon_redemptions FOR SELECT
USING (user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Users can create redemptions"
ON public.coupon_redemptions FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Add coupon columns to orders
ALTER TABLE public.orders
ADD COLUMN coupon_id uuid REFERENCES public.coupons(id) DEFAULT NULL,
ADD COLUMN discount_amount numeric DEFAULT 0;

-- Update trigger for coupons
CREATE TRIGGER update_coupons_updated_at
BEFORE UPDATE ON public.coupons
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();
