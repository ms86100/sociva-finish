-- Fix: rides_select peer EXISTS self-queried rides under RLS →
-- "infinite recursion detected in policy for relation rides"
-- (surfaced when ride_chat_messages INSERT checks rides status).

CREATE OR REPLACE FUNCTION public.cleaner_city_user_on_publication(
  p_publication_id uuid,
  p_uid uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND (r.host_user_id = p_uid OR r.guest_user_id = p_uid)
      AND r.status IN ('confirmed', 'pickup_pending', 'started', 'requested')
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_user_on_publication(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_user_on_publication(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_ride_chat_allowed(
  p_ride_id uuid,
  p_society_id uuid,
  p_uid uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = p_ride_id
      AND r.society_id = p_society_id
      AND (r.host_user_id = p_uid OR r.guest_user_id = p_uid)
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started', 'completed')
      AND NOT EXISTS (
        SELECT 1
        FROM public.commute_blocks b
        WHERE (
          (b.blocker_user_id = r.host_user_id AND b.blocked_user_id = r.guest_user_id)
          OR (b.blocker_user_id = r.guest_user_id AND b.blocked_user_id = r.host_user_id)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_ride_chat_allowed(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_ride_chat_allowed(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS rides_select ON public.rides;
CREATE POLICY rides_select ON public.rides
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.is_society_admin(auth.uid(), society_id)
  OR host_user_id = auth.uid()
  OR guest_user_id = auth.uid()
  OR (
    publication_id IS NOT NULL
    AND public.cleaner_city_user_on_publication(publication_id, auth.uid())
  )
);

DROP POLICY IF EXISTS ride_chat_messages_insert ON public.ride_chat_messages;
CREATE POLICY ride_chat_messages_insert ON public.ride_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.cleaner_city_ride_chat_allowed(ride_id, society_id, auth.uid())
  );
