-- Show derived company names with a capital first letter (sociva -> Sociva).

CREATE OR REPLACE FUNCTION public.cleaner_city_company_name_from_domain(p_domain text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(trim(COALESCE(p_domain, '')));
  v_parts text[];
  v_slug text;
BEGIN
  IF v_domain = '' OR position('.' IN v_domain) = 0 THEN
    RETURN NULL;
  END IF;
  v_parts := string_to_array(v_domain, '.');
  IF array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 2 THEN
    RETURN NULL;
  END IF;
  -- tcs.com -> Tcs; mail.tcs.com / www.sociva.in -> Tcs / Sociva
  IF array_length(v_parts, 1) = 2 THEN
    v_slug := v_parts[1];
  ELSE
    v_slug := v_parts[array_length(v_parts, 1) - 1];
  END IF;
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN NULL;
  END IF;
  RETURN upper(substring(v_slug from 1 for 1)) || substring(v_slug from 2);
END;
$$;

-- Refresh existing auto-derived lowercase company labels.
UPDATE public.company_domains cd
SET
  company_name = public.cleaner_city_company_name_from_domain(cd.domain),
  updated_at = now()
WHERE cd.company_name IS NOT NULL
  AND cd.company_name = lower(cd.company_name)
  AND public.cleaner_city_company_name_from_domain(cd.domain) IS NOT NULL;
