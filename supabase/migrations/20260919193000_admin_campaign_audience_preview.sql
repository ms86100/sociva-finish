-- Admin campaign audience preview: same filters as send-campaign delivery.

CREATE OR REPLACE FUNCTION public.admin_campaign_audience_preview(
  _platform text DEFAULT 'all',
  _society_id uuid DEFAULT NULL,
  _never_ordered boolean DEFAULT false,
  _user_ids uuid[] DEFAULT NULL,
  _exclude_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_count integer,
  device_count integer,
  user_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_users uuid[];
  v_devices integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH token_users AS (
    SELECT DISTINCT dt.user_id
    FROM public.device_tokens dt
    WHERE coalesce(dt.invalid, false) = false
      AND (
        _platform IS NULL
        OR _platform = 'all'
        OR dt.platform = _platform
      )
      AND (_user_ids IS NULL OR dt.user_id = ANY (_user_ids))
  ),
  filtered AS (
    SELECT p.id
    FROM public.profiles p
    INNER JOIN token_users tu ON tu.user_id = p.id
    WHERE (_society_id IS NULL OR p.society_id = _society_id)
      AND (_exclude_user_id IS NULL OR p.id <> _exclude_user_id)
      AND (
        NOT coalesce(_never_ordered, false)
        OR NOT EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.buyer_id = p.id
            AND o.status <> 'cancelled'
        )
      )
  )
  SELECT coalesce(array_agg(f.id), ARRAY[]::uuid[])
  INTO v_users
  FROM filtered f;

  SELECT count(*)::integer
  INTO v_devices
  FROM public.device_tokens dt
  WHERE coalesce(dt.invalid, false) = false
    AND dt.user_id = ANY (v_users)
    AND (
      _platform IS NULL
      OR _platform = 'all'
      OR dt.platform = _platform
    );

  user_count := coalesce(cardinality(v_users), 0);
  device_count := coalesce(v_devices, 0);
  user_ids := v_users;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_campaign_audience_preview(text, uuid, boolean, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_campaign_audience_preview(text, uuid, boolean, uuid[], uuid) TO authenticated;

-- Lightweight list for multi-select picker (admin only).
CREATE OR REPLACE FUNCTION public.admin_campaign_user_directory(
  _search text DEFAULT NULL,
  _society_id uuid DEFAULT NULL,
  _never_ordered boolean DEFAULT false,
  _has_token boolean DEFAULT NULL,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  society_id uuid,
  society_name text,
  has_token boolean,
  never_ordered boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_q text := nullif(trim(coalesce(_search, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    coalesce(p.name, 'User')::text,
    p.phone::text,
    p.society_id,
    s.name::text AS society_name,
    EXISTS (
      SELECT 1
      FROM public.device_tokens dt
      WHERE dt.user_id = p.id
        AND coalesce(dt.invalid, false) = false
    ) AS has_token,
    NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.buyer_id = p.id
        AND o.status <> 'cancelled'
    ) AS never_ordered
  FROM public.profiles p
  LEFT JOIN public.societies s ON s.id = p.society_id
  WHERE (_society_id IS NULL OR p.society_id = _society_id)
    AND (
      v_q IS NULL
      OR p.name ILIKE '%' || v_q || '%'
      OR p.phone ILIKE '%' || v_q || '%'
    )
    AND (
      NOT coalesce(_never_ordered, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.buyer_id = p.id AND o.status <> 'cancelled'
      )
    )
    AND (
      _has_token IS NULL
      OR (
        _has_token = true AND EXISTS (
          SELECT 1 FROM public.device_tokens dt
          WHERE dt.user_id = p.id AND coalesce(dt.invalid, false) = false
        )
      )
      OR (
        _has_token = false AND NOT EXISTS (
          SELECT 1 FROM public.device_tokens dt
          WHERE dt.user_id = p.id AND coalesce(dt.invalid, false) = false
        )
      )
    )
  ORDER BY p.name NULLS LAST, p.created_at DESC
  LIMIT greatest(1, least(coalesce(_limit, 100), 200))
  OFFSET greatest(0, coalesce(_offset, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_campaign_user_directory(text, uuid, boolean, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_campaign_user_directory(text, uuid, boolean, boolean, integer, integer) TO authenticated;
