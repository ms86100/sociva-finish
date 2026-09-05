-- Fix propose_subcategory: do not insert into generated category_requests.normalized_name.
-- Fix location fallback: members can read their society's coords even if society is inactive.

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

  -- normalized_name is GENERATED ALWAYS AS (lower(btrim(requested_name))) — do not insert it.
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

-- Member-safe society pin lookup (bypasses is_active RLS for the caller's own society only).
CREATE OR REPLACE FUNCTION public.get_member_society_location(p_society_id uuid)
RETURNS TABLE (
  latitude double precision,
  longitude double precision,
  name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_society_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.latitude::double precision,
    s.longitude::double precision,
    s.name::text
  FROM public.societies s
  WHERE s.id = p_society_id
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
    AND (
      COALESCE(s.is_active, true) = true
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_uid AND p.society_id = p_society_id
      )
    )
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_society_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_society_location(uuid) TO authenticated;
