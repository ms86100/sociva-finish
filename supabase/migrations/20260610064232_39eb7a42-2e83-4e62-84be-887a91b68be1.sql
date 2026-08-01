
-- 1. Function: ensure a subcategory exists for an approved/merged request
CREATE OR REPLACE FUNCTION public.ensure_subcategory_for_request(req_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
  v_category_slug text;
  v_config_id uuid;
  v_existing_sub_id uuid;
  v_slug text;
  v_base_slug text;
  v_suffix int := 1;
  v_display text;
  v_next_order int;
  v_new_sub_id uuid;
BEGIN
  SELECT * INTO req FROM public.category_requests WHERE id = req_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF req.status NOT IN ('approved','merged') THEN RETURN NULL; END IF;

  -- If already linked to a subcategory, nothing to do
  IF req.created_subcategory_id IS NOT NULL THEN RETURN req.created_subcategory_id; END IF;
  IF req.merge_target_subcategory_id IS NOT NULL THEN RETURN req.merge_target_subcategory_id; END IF;

  -- Resolve parent category slug
  v_category_slug := COALESCE(req.parent_category_slug, req.created_category, req.merge_target_category);
  IF v_category_slug IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_config_id FROM public.category_config WHERE category = v_category_slug LIMIT 1;
  IF v_config_id IS NULL THEN RETURN NULL; END IF;

  v_display := initcap(trim(req.requested_name));
  IF v_display IS NULL OR length(v_display) = 0 THEN RETURN NULL; END IF;

  -- Check for an existing subcategory in this category by display name (case-insensitive)
  SELECT id INTO v_existing_sub_id
  FROM public.subcategories
  WHERE category_config_id = v_config_id
    AND lower(display_name) = lower(v_display)
  LIMIT 1;

  IF v_existing_sub_id IS NOT NULL THEN
    IF req.request_kind = 'subcategory' OR req.status = 'merged' THEN
      UPDATE public.category_requests
        SET merge_target_subcategory_id = v_existing_sub_id,
            parent_category_slug = COALESCE(parent_category_slug, v_category_slug)
        WHERE id = req.id;
    ELSE
      UPDATE public.category_requests
        SET created_subcategory_id = v_existing_sub_id,
            parent_category_slug = COALESCE(parent_category_slug, v_category_slug)
        WHERE id = req.id;
    END IF;
    RETURN v_existing_sub_id;
  END IF;

  -- Build a unique slug
  v_base_slug := regexp_replace(lower(trim(req.requested_name)), '[^a-z0-9]+', '_', 'g');
  v_base_slug := regexp_replace(v_base_slug, '^_+|_+$', '', 'g');
  IF v_base_slug IS NULL OR length(v_base_slug) = 0 THEN v_base_slug := 'item'; END IF;
  v_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.subcategories
    WHERE category_config_id = v_config_id AND slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '_' || v_suffix;
  END LOOP;

  SELECT COALESCE(MAX(display_order), 0) + 1 INTO v_next_order
  FROM public.subcategories WHERE category_config_id = v_config_id;

  INSERT INTO public.subcategories (category_config_id, slug, display_name, display_order, is_active)
  VALUES (v_config_id, v_slug, v_display, v_next_order, true)
  RETURNING id INTO v_new_sub_id;

  IF req.request_kind = 'subcategory' OR req.status = 'merged' THEN
    UPDATE public.category_requests
      SET merge_target_subcategory_id = v_new_sub_id,
          parent_category_slug = COALESCE(parent_category_slug, v_category_slug)
      WHERE id = req.id;
  ELSE
    UPDATE public.category_requests
      SET created_subcategory_id = v_new_sub_id,
          parent_category_slug = COALESCE(parent_category_slug, v_category_slug)
      WHERE id = req.id;
  END IF;

  RETURN v_new_sub_id;
END;
$$;

-- 2. Trigger function wrapper
CREATE OR REPLACE FUNCTION public.tg_ensure_subcategory_for_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('approved','merged')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.ensure_subcategory_for_request(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_subcategory_for_request ON public.category_requests;
CREATE TRIGGER trg_ensure_subcategory_for_request
AFTER INSERT OR UPDATE OF status ON public.category_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_subcategory_for_request();

-- 3. Backfill existing approved/merged rows that have no resolved subcategory
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.category_requests
    WHERE status IN ('approved','merged')
      AND created_subcategory_id IS NULL
      AND merge_target_subcategory_id IS NULL
  LOOP
    PERFORM public.ensure_subcategory_for_request(r.id);
  END LOOP;
END $$;
