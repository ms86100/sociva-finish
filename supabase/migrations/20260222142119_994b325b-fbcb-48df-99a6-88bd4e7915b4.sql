CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id UUID)
RETURNS TABLE(
  feature_key text,
  is_enabled boolean,
  source text,
  society_configurable boolean,
  display_name text,
  description text,
  icon_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _builder_id UUID;
  _package_id UUID;
BEGIN
  -- Find builder for this society
  SELECT bs.builder_id INTO _builder_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  -- Find active package for builder
  IF _builder_id IS NOT NULL THEN
    SELECT bfp.package_id INTO _package_id
    FROM public.builder_feature_packages bfp
    WHERE bfp.builder_id = _builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    ORDER BY bfp.assigned_at DESC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    pf.feature_key,
    CASE
      -- Core features always enabled
      WHEN pf.is_core THEN true
      -- Check society override first
      WHEN sfo.id IS NOT NULL THEN sfo.is_enabled
      -- Check package inclusion (FIX: column is "enabled" not "is_enabled")
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL THEN fpi.enabled
      -- No builder assigned = default enabled; builder assigned but feature not in package = disabled
      ELSE (_builder_id IS NULL)
    END AS is_enabled,
    CASE
      WHEN pf.is_core THEN 'core'
      WHEN sfo.id IS NOT NULL THEN 'override'
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL THEN 'package'
      ELSE 'default'
    END AS source,
    CASE
      WHEN pf.is_core THEN false
      -- FIX: column is "enabled" not "is_enabled"
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL AND NOT fpi.enabled THEN false
      ELSE true
    END AS society_configurable,
    pf.display_name,
    pf.description,
    pf.icon_name
  FROM public.platform_features pf
  LEFT JOIN public.society_feature_overrides sfo
    ON sfo.feature_id = pf.id AND sfo.society_id = _society_id
  LEFT JOIN public.feature_package_items fpi
    ON fpi.package_id = _package_id AND fpi.feature_id = pf.id
  ORDER BY pf.feature_key;
END;
$function$;