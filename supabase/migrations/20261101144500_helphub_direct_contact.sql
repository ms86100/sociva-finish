-- HelpHub: recommender flat + direct contact phone RPC

ALTER TABLE public.helphub_listings
  ADD COLUMN IF NOT EXISTS recommender_flat text;

CREATE OR REPLACE FUNCTION public.helphub_get_contact_phone(p_listing_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF v_listing.society_id <> public.get_user_society_id(v_uid) AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Cross-society access denied';
  END IF;
  IF v_listing.status <> 'active' OR v_listing.expires_at <= now() THEN
    RAISE EXCEPTION 'Listing is not available';
  END IF;
  IF v_listing.private_phone IS NULL OR length(trim(v_listing.private_phone)) < 8 THEN
    RAISE EXCEPTION 'Phone number not available';
  END IF;

  PERFORM public.helphub_log(
    v_listing.society_id,
    'contact_called',
    'helphub_listing',
    v_listing.id,
    '{}'::jsonb
  );

  RETURN v_listing.private_phone;
END;
$$;

GRANT EXECUTE ON FUNCTION public.helphub_get_contact_phone(uuid) TO authenticated;
