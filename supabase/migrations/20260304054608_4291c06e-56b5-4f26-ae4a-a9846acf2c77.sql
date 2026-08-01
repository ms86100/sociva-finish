
-- Atomic device token claiming: deletes token from other users, upserts for current user.
-- Uses SECURITY DEFINER to bypass RLS for cross-user cleanup.
CREATE OR REPLACE FUNCTION public.claim_device_token(
  p_user_id UUID,
  p_token TEXT,
  p_platform TEXT,
  p_apns_token TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Remove this token from any OTHER user
  DELETE FROM public.device_tokens
  WHERE token = p_token
    AND user_id != p_user_id;

  -- 2. Upsert for the current user — never overwrite a good apns_token with null
  INSERT INTO public.device_tokens (user_id, token, platform, apns_token, updated_at)
  VALUES (p_user_id, p_token, p_platform, p_apns_token, now())
  ON CONFLICT (user_id, token)
  DO UPDATE SET
    platform   = EXCLUDED.platform,
    apns_token = COALESCE(EXCLUDED.apns_token, device_tokens.apns_token),
    updated_at = now();
END;
$$;
