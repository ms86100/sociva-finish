
CREATE OR REPLACE FUNCTION public.resolve_society(
  _input_name text,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _google_place_id text DEFAULT NULL
) RETURNS TABLE(
  society_id uuid, society_name text, match_type text, confidence numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _normalized text;
BEGIN
  _normalized := lower(trim(_input_name));
  _normalized := regexp_replace(_normalized, '\s*(phase|ph|tower|block|wing|sec|sector)\s*[\d\-IiVvXx]*', '', 'gi');
  _normalized := regexp_replace(_normalized, '\s+', ' ', 'g');
  _normalized := trim(_normalized);

  -- 1. Exact google_place_id match (confidence 1.0)
  IF _google_place_id IS NOT NULL THEN
    RETURN QUERY
    SELECT sa.society_id, s.name, 'place_id'::text, 1.0::numeric
    FROM society_aliases sa JOIN societies s ON s.id = sa.society_id
    WHERE sa.google_place_id = _google_place_id AND s.is_active = true
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Exact normalized match on societies (0.95)
  RETURN QUERY
  SELECT s.id, s.name, 'exact'::text, 0.95::numeric
  FROM societies s WHERE s.normalized_name = _normalized AND s.is_active = true
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- 3. Exact alias match (0.9)
  RETURN QUERY
  SELECT sa.society_id, s.name, 'alias'::text, 0.9::numeric
  FROM society_aliases sa JOIN societies s ON s.id = sa.society_id
  WHERE sa.normalized_alias = _normalized AND s.is_active = true
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- 4. Fuzzy trigram match — return top 3
  RETURN QUERY
  SELECT s.id, s.name, 'fuzzy'::text,
    round(similarity(s.normalized_name, _normalized)::numeric, 2) as conf
  FROM societies s
  WHERE s.normalized_name IS NOT NULL AND s.is_active = true
    AND similarity(s.normalized_name, _normalized) > 0.35
  ORDER BY similarity(s.normalized_name, _normalized) DESC
  LIMIT 3;
  IF FOUND THEN RETURN; END IF;

  -- 5. Geo-radius match within 500m (0.4)
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    RETURN QUERY
    SELECT s.id, s.name, 'geo'::text, 0.4::numeric
    FROM societies s
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND s.is_active = true
      AND public.haversine_km(_lat, _lng, s.latitude::double precision, s.longitude::double precision) < 0.5
    ORDER BY public.haversine_km(_lat, _lng, s.latitude::double precision, s.longitude::double precision)
    LIMIT 3;
  END IF;

  RETURN;
END;
$$;
