
INSERT INTO public.category_config (
  category, display_name, parent_group, icon, color,
  is_active, show_veg_toggle, show_duration_field,
  default_action_type, requires_price, is_physical_product,
  has_quantity, layout_type, transaction_type, display_order
)
SELECT 'other-' || pg.slug,
       'Other ' || pg.name,
       pg.slug,
       coalesce(pg.icon, 'Package'),
       coalesce(pg.color, '#6b7280'),
       true, false, false,
       'contact_seller',
       false, false, false,
       'grid', 'self_fulfillment', 9999
FROM public.parent_groups pg
WHERE pg.is_active = true
ON CONFLICT (category) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.category_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL,
  requested_name text NOT NULL,
  parent_group_hint text,
  example_product text,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  resolved_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.category_requests TO authenticated;
GRANT ALL ON public.category_requests TO service_role;

ALTER TABLE public.category_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers insert their own requests" ON public.category_requests;
CREATE POLICY "Sellers insert their own requests"
  ON public.category_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

DROP POLICY IF EXISTS "Sellers read their own requests" ON public.category_requests;
CREATE POLICY "Sellers read their own requests"
  ON public.category_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage requests" ON public.category_requests;
CREATE POLICY "Admins manage requests"
  ON public.category_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_category_requests_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_requests_updated_at ON public.category_requests;
CREATE TRIGGER trg_category_requests_updated_at
  BEFORE UPDATE ON public.category_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_category_requests_updated_at();

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS categories_deferred boolean NOT NULL DEFAULT false;
