
-- Add Android dedup to claim_device_token
CREATE OR REPLACE FUNCTION public.claim_device_token(p_user_id uuid, p_token text, p_platform text, p_apns_token text DEFAULT NULL::text)
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

  -- APNs token rotation cleanup: when a NEW apns_token arrives for iOS,
  -- remove all older iOS entries for this user with a DIFFERENT apns_token.
  IF p_platform = 'ios' AND p_apns_token IS NOT NULL THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND platform = 'ios'
      AND apns_token IS NOT NULL
      AND apns_token != p_apns_token;
  END IF;

  -- Android dedup: when a new Android token is registered,
  -- remove all older Android entries for this user with a different token.
  IF p_platform = 'android' THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND platform = 'android'
      AND token != p_token;
  END IF;
END;
$function$;
