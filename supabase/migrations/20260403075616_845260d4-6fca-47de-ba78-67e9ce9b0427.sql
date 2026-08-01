-- Product favorites table
CREATE TABLE public.product_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);

ALTER TABLE public.product_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own product favorites"
  ON public.product_favorites FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add product favorites"
  ON public.product_favorites FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their own product favorites"
  ON public.product_favorites FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Product views table for seller analytics
CREATE TABLE public.product_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert product views"
  ON public.product_views FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = viewer_id);

CREATE POLICY "Sellers can view their product views"
  ON public.product_views FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.seller_profiles sp ON sp.id = p.seller_id
      WHERE p.id = product_views.product_id
        AND sp.user_id = auth.uid()
    )
  );

-- Vacation mode columns for sellers
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS vacation_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS vacation_until DATE DEFAULT NULL;

-- Notification trigger: when favorited seller adds new product
CREATE OR REPLACE FUNCTION public.notify_favorited_seller_new_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_queue (user_id, title, body, type, data)
  SELECT
    f.user_id,
    'New from ' || sp.business_name,
    NEW.name || ' just added!',
    'new_product',
    jsonb_build_object('product_id', NEW.id, 'seller_id', NEW.seller_id)
  FROM public.favorites f
  JOIN public.seller_profiles sp ON sp.id = f.seller_id
  WHERE f.seller_id = NEW.seller_id
    AND f.user_id != sp.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_favorited_seller_new_product
  AFTER INSERT ON public.products
  FOR EACH ROW
  WHEN (NEW.is_available = true AND NEW.approval_status = 'approved')
  EXECUTE FUNCTION public.notify_favorited_seller_new_product();