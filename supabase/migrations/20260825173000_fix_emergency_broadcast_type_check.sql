-- Emergency broadcast UI categories (water_shutdown, power_outage, …) were
-- written into emergency_broadcasts.type, but the CHECK only allowed
-- fire|medical|security|natural_disaster|general → insert failed → "Action failed".

BEGIN;

ALTER TABLE public.emergency_broadcasts
  DROP CONSTRAINT IF EXISTS emergency_broadcasts_type_check;

ALTER TABLE public.emergency_broadcasts
  ADD CONSTRAINT emergency_broadcasts_type_check
  CHECK (
    type = ANY (ARRAY[
      -- legacy coarse types
      'fire', 'medical', 'security', 'natural_disaster', 'general',
      -- admin UI categories
      'water_shutdown', 'power_outage', 'security_alert', 'maintenance', 'fire_drill'
    ]::text[])
  );

-- Map UI category → coarse type for legacy readers; keep UI value in category.
CREATE OR REPLACE FUNCTION public.admin_send_emergency_broadcast(
  p_society_id uuid,
  p_category text,
  p_title text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_broadcast_id uuid;
  v_category text := COALESCE(NULLIF(trim(p_category), ''), 'general');
  v_type text;
  v_notify jsonb;
  v_society_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_society_id IS NULL THEN
    RAISE EXCEPTION 'Select a society before sending a broadcast';
  END IF;
  IF NULLIF(trim(p_title), '') IS NULL OR NULLIF(trim(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'title and body required';
  END IF;

  SELECT s.name INTO v_society_name
  FROM public.societies s
  WHERE s.id = p_society_id;

  IF v_society_name IS NULL THEN
    RAISE EXCEPTION 'Society not found';
  END IF;

  -- Allowed UI + legacy values (must match emergency_broadcasts_type_check)
  IF v_category = ANY (ARRAY[
    'fire', 'medical', 'security', 'natural_disaster', 'general',
    'water_shutdown', 'power_outage', 'security_alert', 'maintenance', 'fire_drill'
  ]::text[]) THEN
    v_type := v_category;
  ELSE
    v_type := 'general';
    v_category := 'general';
  END IF;

  INSERT INTO public.emergency_broadcasts (
    society_id, sender_id, sent_by, type, category, title, message, body
  ) VALUES (
    p_society_id,
    v_uid,
    v_uid,
    v_type,
    v_category,
    trim(p_title),
    trim(p_body),
    trim(p_body)
  )
  RETURNING id INTO v_broadcast_id;

  v_notify := public.admin_notify_society_members(
    p_society_id,
    trim(p_title),
    trim(p_body),
    'broadcast',
    jsonb_build_object(
      'category', v_category,
      'broadcast_id', v_broadcast_id,
      'type', 'broadcast',
      'society_id', p_society_id,
      'society_name', v_society_name
    ),
    true,
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'notified_count', COALESCE((v_notify->>'notified_count')::int, 0),
    'society_id', p_society_id,
    'society_name', v_society_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_emergency_broadcast(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_emergency_broadcast(uuid, text, text, text)
  TO authenticated, service_role;

COMMIT;
