-- Client-side inserts into notification_queue for other users are blocked by RLS
-- (INSERT only allowed when user_id = auth.uid()). Route admin + cross-user
-- notifications through SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.notify_platform_admins_new_store_application(
  p_seller_user_id uuid,
  p_business_name text,
  p_seller_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store text := COALESCE(NULLIF(btrim(p_business_name), ''), 'A store');
  v_key text;
BEGIN
  IF p_seller_user_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_admin(auth.uid())
     AND auth.uid() IS DISTINCT FROM p_seller_user_id THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF p_seller_id IS NOT NULL
     AND auth.uid() = p_seller_user_id
     AND NOT public.is_admin(auth.uid()) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = p_seller_id
        AND sp.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  v_key := 'admin_new_store:' || COALESCE(p_seller_id::text, p_seller_user_id::text);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  )
  SELECT
    ur.user_id,
    '🏪 New Store Application',
    '"' || v_store || '" has been submitted for review. Tap to moderate.',
    'moderation',
    '/admin',
    jsonb_build_object(
      'type', 'new_store_application',
      'target_role', 'admin',
      'seller_id', p_seller_id,
      'seller_user_id', p_seller_user_id
    ),
    v_key || ':' || ur.user_id::text
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM p_seller_user_id
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_category_request(
  p_requester_user_id uuid,
  p_requested_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := COALESCE(NULLIF(btrim(p_requested_name), ''), 'a category');
  v_key text;
BEGIN
  IF p_requester_user_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_requester_user_id THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_key := 'admin_category_request:' || md5(v_name || ':' || p_requester_user_id::text);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  )
  SELECT
    ur.user_id,
    '📂 New category request',
    'A seller requested "' || v_name || '". Tap to review in Catalog.',
    'moderation',
    '/admin',
    jsonb_build_object(
      'type', 'category_request',
      'target_role', 'admin',
      'requested_name', v_name,
      'requester_user_id', p_requester_user_id
    ),
    v_key || ':' || ur.user_id::text
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM p_requester_user_id
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_for_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_type text,
  p_reference_path text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR p_body IS NULL OR p_type IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload
  ) VALUES (
    p_user_id, p_title, p_body, p_type, p_reference_path, COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_enqueue_seller_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status IN ('pending', 'approved', 'rejected', 'suspended') THEN
    BEGIN
      PERFORM public.enqueue_seller_lifecycle_notification(
        NEW.user_id,
        NEW.business_name,
        NEW.verification_status,
        NEW.id,
        NEW.rejection_note
      );
    EXCEPTION WHEN others THEN
      RAISE WARNING 'enqueue seller lifecycle failed: %', SQLERRM;
    END;

    IF NEW.verification_status = 'pending' THEN
      BEGIN
        PERFORM public.notify_platform_admins_new_store_application(
          NEW.user_id,
          NEW.business_name,
          NEW.id
        );
      EXCEPTION WHEN others THEN
        RAISE WARNING 'notify admins new store failed: %', SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_platform_admins_new_store_application(uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_new_store_application(uuid, text, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.notify_platform_admins_category_request(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_category_request(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_notification_for_user(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_for_user(uuid, text, text, text, text, jsonb)
  TO authenticated, service_role;
