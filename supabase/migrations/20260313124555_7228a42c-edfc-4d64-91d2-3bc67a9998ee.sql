
-- Update claim_device_token to support saving APNs-only tokens.
-- When p_token starts with 'apns:' it means FCM was unavailable.
-- If a later call provides a real FCM token for the same apns_token, it replaces the placeholder.
CREATE OR REPLACE FUNCTION public.claim_device_token(
  p_user_id uuid,
  p_token text,
  p_platform text,
  p_apns_token text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If we have an APNs token and a real FCM token, first clean up any apns-only placeholder
  IF p_apns_token IS NOT NULL AND NOT (p_token LIKE 'apns:%') THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND token LIKE 'apns:%'
      AND apns_token = p_apns_token;
  END IF;

  -- Upsert the current token
  INSERT INTO public.device_tokens (user_id, token, platform, apns_token)
  VALUES (p_user_id, p_token, p_platform, p_apns_token)
  ON CONFLICT (user_id, token) DO UPDATE
    SET platform = EXCLUDED.platform,
        apns_token = EXCLUDED.apns_token,
        updated_at = now();

  -- Remove stale rows for the same user+device (same apns_token but different FCM token)
  IF p_apns_token IS NOT NULL THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND apns_token = p_apns_token
      AND token != p_token;
  END IF;
END;
$function$;
