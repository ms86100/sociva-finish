-- Additive: seller_domain on category_config + user-proposed subcategory support.
-- Zero-regression: existing columns/rows kept; seller_domain nullable then backfilled.

ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS seller_domain text;

ALTER TABLE public.category_config
  DROP CONSTRAINT IF EXISTS category_config_seller_domain_check;

ALTER TABLE public.category_config
  ADD CONSTRAINT category_config_seller_domain_check
  CHECK (seller_domain IS NULL OR seller_domain IN ('product', 'service', 'listing'));

COMMENT ON COLUMN public.category_config.seller_domain IS
  'Seller-facing domain for onboarding forms: product | service | listing. Action stays on default_action_type.';

UPDATE public.category_config
SET seller_domain = CASE
  WHEN parent_group = 'property' THEN 'listing'
  WHEN default_action_type = 'contact_seller' OR transaction_type = 'contact_enquiry' THEN 'listing'
  WHEN parent_group = 'events' THEN 'listing'
  WHEN parent_group = 'professional'
       AND COALESCE(requires_time_slot, false) = false
       AND (COALESCE(enquiry_only, false) = true OR default_action_type = 'request_service')
    THEN 'listing'
  WHEN parent_group = 'resale' THEN 'product'
  WHEN category = 'pet_food' THEN 'product'
  WHEN COALESCE(supports_cart, false) = true OR default_action_type = 'add_to_cart' THEN 'product'
  WHEN parent_group = 'food_beverages' AND category NOT LIKE 'other%' THEN 'product'
  ELSE 'service'
END
WHERE seller_domain IS NULL;

ALTER TABLE public.subcategories
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS normalized_key text,
  ADD COLUMN IF NOT EXISTS proposed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved';

ALTER TABLE public.subcategories
  DROP CONSTRAINT IF EXISTS subcategories_origin_check;

ALTER TABLE public.subcategories
  ADD CONSTRAINT subcategories_origin_check
  CHECK (origin IN ('system', 'user_proposed'));

ALTER TABLE public.subcategories
  DROP CONSTRAINT IF EXISTS subcategories_review_status_check;

ALTER TABLE public.subcategories
  ADD CONSTRAINT subcategories_review_status_check
  CHECK (review_status IN ('approved', 'pending', 'rejected', 'merged'));

CREATE OR REPLACE FUNCTION public.normalize_taxonomy_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(
    regexp_replace(lower(trim(COALESCE(p_name, ''))), '[^a-z0-9]+', '-', 'g'),
    '-+', '-', 'g'
  ));
$$;

UPDATE public.subcategories
SET normalized_key = public.normalize_taxonomy_key(display_name)
WHERE normalized_key IS NULL OR normalized_key = '';

CREATE UNIQUE INDEX IF NOT EXISTS subcategories_category_normalized_key_uidx
  ON public.subcategories (category_config_id, normalized_key)
  WHERE normalized_key IS NOT NULL AND normalized_key <> '' AND is_active = true;

-- Instant propose: reuse existing subcategory or insert user_proposed + queue category_requests.
CREATE OR REPLACE FUNCTION public.propose_subcategory(
  p_category_config_id uuid,
  p_display_name text,
  p_seller_id uuid DEFAULT NULL,
  p_draft_product_id uuid DEFAULT NULL
)
RETURNS TABLE (
  subcategory_id uuid,
  display_name text,
  slug text,
  created_new boolean,
  category_slug text,
  parent_group text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := trim(COALESCE(p_display_name, ''));
  v_key text;
  v_slug text;
  v_cat public.category_config%ROWTYPE;
  v_existing public.subcategories%ROWTYPE;
  v_new_id uuid;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF length(v_name) < 2 THEN
    RAISE EXCEPTION 'Subcategory name too short';
  END IF;

  SELECT * INTO v_cat
  FROM public.category_config
  WHERE id = p_category_config_id AND COALESCE(is_active, true) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  v_key := public.normalize_taxonomy_key(v_name);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Invalid subcategory name';
  END IF;

  SELECT * INTO v_existing
  FROM public.subcategories s
  WHERE s.category_config_id = p_category_config_id
    AND s.normalized_key = v_key
    AND s.is_active = true
  ORDER BY CASE WHEN s.origin = 'system' THEN 0 ELSE 1 END, s.created_at
  LIMIT 1;

  IF FOUND THEN
    subcategory_id := v_existing.id;
    display_name := v_existing.display_name;
    slug := v_existing.slug;
    created_new := false;
    category_slug := v_cat.category;
    parent_group := v_cat.parent_group;
    RETURN NEXT;
    RETURN;
  END IF;

  v_slug := left(v_key, 80);
  IF EXISTS (
    SELECT 1 FROM public.subcategories s
    WHERE s.category_config_id = p_category_config_id AND s.slug = v_slug
  ) THEN
    v_slug := left(v_key, 60) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;

  INSERT INTO public.subcategories (
    category_config_id, slug, display_name, display_order, is_active,
    origin, normalized_key, proposed_by, review_status
  ) VALUES (
    p_category_config_id, v_slug, v_name, 999, true,
    'user_proposed', v_key, v_uid, 'pending'
  )
  RETURNING id INTO v_new_id;

  v_created := true;

  -- normalized_name is GENERATED ALWAYS — omit from INSERT.
  INSERT INTO public.category_requests (
    requested_by,
    requested_name,
    parent_group_hint,
    parent_group_slug,
    parent_category_config_id,
    parent_category_slug,
    seller_id,
    draft_product_id,
    created_subcategory_id,
    request_kind,
    status
  ) VALUES (
    v_uid,
    v_name,
    v_cat.parent_group,
    v_cat.parent_group,
    p_category_config_id,
    v_cat.category,
    p_seller_id,
    p_draft_product_id,
    v_new_id,
    'subcategory',
    'pending'
  );

  subcategory_id := v_new_id;
  display_name := v_name;
  slug := v_slug;
  created_new := v_created;
  category_slug := v_cat.category;
  parent_group := v_cat.parent_group;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_subcategory(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_subcategory(uuid, text, uuid, uuid) TO authenticated;

-- Conservative cleanup: only merge obvious user_proposed duplicates into an earlier active row.
CREATE OR REPLACE FUNCTION public.cleanup_user_proposed_subcategories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merged integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      a.id AS keep_id,
      b.id AS drop_id
    FROM public.subcategories a
    JOIN public.subcategories b
      ON a.category_config_id = b.category_config_id
     AND a.normalized_key = b.normalized_key
     AND a.id <> b.id
    WHERE a.is_active = true
      AND b.is_active = true
      AND b.origin = 'user_proposed'
      AND b.review_status = 'pending'
      AND a.created_at <= b.created_at
      AND a.normalized_key IS NOT NULL
      AND length(a.normalized_key) >= 3
  LOOP
    UPDATE public.products
    SET subcategory_id = r.keep_id
    WHERE subcategory_id = r.drop_id;

    UPDATE public.subcategories
    SET is_active = false,
        review_status = 'merged'
    WHERE id = r.drop_id;

    UPDATE public.category_requests
    SET status = 'resolved',
        created_subcategory_id = r.keep_id,
        merge_target_subcategory_id = r.keep_id,
        reviewed_at = now()
    WHERE created_subcategory_id = r.drop_id
      AND status = 'pending';

    v_merged := v_merged + 1;
  END LOOP;

  RETURN v_merged;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_user_proposed_subcategories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_user_proposed_subcategories() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'cleanup-user-proposed-subcategories';

    PERFORM cron.schedule(
      'cleanup-user-proposed-subcategories',
      '*/30 * * * *',
      $$SELECT public.cleanup_user_proposed_subcategories();$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule taxonomy cleanup cron: %', SQLERRM;
END $$;
