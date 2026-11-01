-- Enrich Find matches with plate / make / model without rewriting full matcher.
-- Guests only see cards for published seats they could already discover.

CREATE OR REPLACE FUNCTION public.cleaner_city_publication_vehicle_cards(p_publication_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_publication_ids IS NULL OR cardinality(p_publication_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'publication_id', p.id,
      'vehicle_type', v.vehicle_type,
      'vehicle_color', NULLIF(trim(COALESCE(v.color, '')), ''),
      'vehicle_make', NULLIF(trim(COALESCE(v.make, '')), ''),
      'vehicle_model', NULLIF(trim(COALESCE(v.model, '')), ''),
      'vehicle_registration', NULLIF(upper(regexp_replace(COALESCE(v.registration_number, ''), '\s+', '', 'g')), '')
    ) ORDER BY p.id), '[]'::jsonb)
    FROM public.commute_publications p
    JOIN public.vehicles v ON v.id = p.vehicle_id AND v.is_active = true
    WHERE p.id = ANY (p_publication_ids)
      AND p.status = 'published'
      AND p.host_user_id <> v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_publication_vehicle_cards(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_publication_vehicle_cards(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_publication_vehicle_cards(uuid[]) IS
  'Find card enrichment: vehicle type, color, make, model, registration for published seats.';
