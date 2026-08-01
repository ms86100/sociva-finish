CREATE OR REPLACE FUNCTION public.claim_device_token(p_user_id uuid, p_token text, p_platform text, p_apns_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Upsert the current token
  INSERT INTO public.device_tokens (user_id, token, platform, apns_token)
  VALUES (p_user_id, p_token, p_platform, p_apns_token)
  ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, apns_token = EXCLUDED.apns_token, updated_at = now();

  -- Remove stale rows for the same user+device (same apns_token but different FCM token)
  -- This prevents duplicate push deliveries when FCM tokens rotate on iOS
  IF p_apns_token IS NOT NULL THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND apns_token = p_apns_token
      AND token != p_token;
  END IF;
END;
$function$;