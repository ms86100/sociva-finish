
-- 1. Add license config columns to parent_groups
ALTER TABLE public.parent_groups
  ADD COLUMN IF NOT EXISTS requires_license boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS license_type_name text,
  ADD COLUMN IF NOT EXISTS license_description text,
  ADD COLUMN IF NOT EXISTS license_mandatory boolean NOT NULL DEFAULT false;

-- 2. Create seller_licenses table
CREATE TABLE public.seller_licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.parent_groups(id) ON DELETE CASCADE,
  license_type text NOT NULL,
  license_number text,
  document_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(seller_id, group_id)
);

-- Enable RLS
ALTER TABLE public.seller_licenses ENABLE ROW LEVEL SECURITY;

-- RLS: Sellers can view their own licenses
CREATE POLICY "Sellers can view their own licenses"
  ON public.seller_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.seller_profiles
      WHERE seller_profiles.id = seller_licenses.seller_id
        AND seller_profiles.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

-- RLS: Sellers can insert their own licenses
CREATE POLICY "Sellers can insert their own licenses"
  ON public.seller_licenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seller_profiles
      WHERE seller_profiles.id = seller_licenses.seller_id
        AND seller_profiles.user_id = auth.uid()
    )
  );

-- RLS: Sellers can update their own licenses (re-upload after rejection)
CREATE POLICY "Sellers can update their own licenses"
  ON public.seller_licenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.seller_profiles
      WHERE seller_profiles.id = seller_licenses.seller_id
        AND seller_profiles.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

-- 3. Backend enforcement: check mandatory license before product insert/update
CREATE OR REPLACE FUNCTION public.check_seller_license()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  _primary_group text;
  _group_id uuid;
  _license_mandatory boolean;
  _has_approved_license boolean;
BEGIN
  -- Get seller's primary group
  SELECT primary_group INTO _primary_group
  FROM public.seller_profiles WHERE id = NEW.seller_id;

  IF _primary_group IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get group config
  SELECT id, license_mandatory INTO _group_id, _license_mandatory
  FROM public.parent_groups
  WHERE slug = _primary_group AND requires_license = true;

  IF _group_id IS NULL OR _license_mandatory IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Check for approved license
  SELECT EXISTS (
    SELECT 1 FROM public.seller_licenses
    WHERE seller_id = NEW.seller_id
      AND group_id = _group_id
      AND status = 'approved'
  ) INTO _has_approved_license;

  IF NOT _has_approved_license THEN
    RAISE EXCEPTION 'Cannot create or update products: mandatory license for this category has not been approved. Please upload and get your % approved first.', 
      (SELECT license_type_name FROM public.parent_groups WHERE id = _group_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_seller_license_before_product
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_seller_license();

-- 4. Seed food group with license config
UPDATE public.parent_groups
SET
  requires_license = true,
  license_type_name = 'FSSAI Certificate',
  license_description = 'Upload your FSSAI registration certificate or food license (PDF, JPG, PNG). This is legally required for all food businesses in India.',
  license_mandatory = true
WHERE slug = 'food';

-- 5. Migrate existing food license data from seller_profiles to seller_licenses
INSERT INTO public.seller_licenses (seller_id, group_id, license_type, license_number, document_url, status, submitted_at, reviewed_at)
SELECT
  sp.id,
  pg.id,
  'FSSAI Certificate',
  sp.fssai_number,
  sp.food_license_url,
  CASE
    WHEN sp.food_license_status = 'approved' THEN 'approved'
    WHEN sp.food_license_status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END,
  COALESCE(sp.food_license_submitted_at, now()),
  sp.food_license_reviewed_at
FROM public.seller_profiles sp
JOIN public.parent_groups pg ON pg.slug = 'food'
WHERE sp.food_license_url IS NOT NULL
  AND sp.food_license_status IS DISTINCT FROM 'none'
ON CONFLICT (seller_id, group_id) DO NOTHING;
