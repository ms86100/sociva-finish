-- Game progress stays computed from real commute rows.
-- Full chat inbox, Razorpay route transfer records, 5 office stops,
-- WhatsApp fallback after SMS fails, then an in-app admin alert.
-- Does not insert meetup coordinates. Does not send SMS by itself.

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.commute_publication_stops') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102250000 before this migration';
  END IF;
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'commute_publication_stops'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%seq%'
  LOOP
    EXECUTE format('ALTER TABLE public.commute_publication_stops DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'cleaner_city_badges'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%badge_key%'
  LOOP
    EXECUTE format('ALTER TABLE public.cleaner_city_badges DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'ride_fuel_payments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%payout_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.ride_fuel_payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'cleaner_city_outbound_alerts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE public.cleaner_city_outbound_alerts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.commute_publication_stops
  ADD CONSTRAINT commute_publication_stops_seq_check CHECK (seq BETWEEN 1 AND 5);

ALTER TABLE public.cleaner_city_badges
  ADD CONSTRAINT cleaner_city_badges_badge_key_check CHECK (badge_key IN (
    'first_ride', 'five_rides', 'ten_rides', 'reliable_host', 'circle_rider',
    'safety_ready', 'city_explorer', 'multi_office'
  ));

ALTER TABLE public.ride_fuel_payments
  ADD CONSTRAINT ride_fuel_payments_payout_status_check
  CHECK (payout_status IN ('unpaid', 'payable', 'failed', 'transferred'));

ALTER TABLE public.ride_fuel_payments
  ADD COLUMN IF NOT EXISTS transfer_id text,
  ADD COLUMN IF NOT EXISTS transfer_error text,
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz;

ALTER TABLE public.cleaner_city_outbound_alerts
  ADD CONSTRAINT cleaner_city_outbound_alerts_channel_check
  CHECK (channel IN ('sms', 'call', 'whatsapp'));

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS razorpay_route_account_id text;

CREATE TABLE IF NOT EXISTS public.commute_direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_commute_direct_messages_pair
  ON public.commute_direct_messages (sender_id, recipient_id, created_at DESC);

ALTER TABLE public.commute_direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_direct_messages_select ON public.commute_direct_messages;
CREATE POLICY commute_direct_messages_select ON public.commute_direct_messages
  FOR SELECT TO authenticated
  USING (
    (sender_id = auth.uid() OR recipient_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = auth.uid() AND b.blocked_user_id = CASE WHEN sender_id = auth.uid() THEN recipient_id ELSE sender_id END)
         OR (b.blocked_user_id = auth.uid() AND b.blocker_user_id = CASE WHEN sender_id = auth.uid() THEN recipient_id ELSE sender_id END)
    )
  );

CREATE OR REPLACE FUNCTION public.cleaner_city_set_publication_stop(
  p_publication_id uuid,
  p_seq integer,
  p_label text,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS public.commute_publication_stops
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pub public.commute_publications;
  v_row public.commute_publication_stops;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_seq IS NULL OR p_seq < 1 OR p_seq > 5 THEN
    RAISE EXCEPTION 'A commute can have up to 5 office stops';
  END IF;
  IF p_label IS NULL OR char_length(trim(p_label)) < 2 THEN
    RAISE EXCEPTION 'Stop label is required';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'Enter the real stop latitude and longitude';
  END IF;
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id;
  IF v_pub.id IS NULL OR v_pub.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;
  IF v_pub.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Stops can be edited on a draft or published commute';
  END IF;
  INSERT INTO public.commute_publication_stops (
    publication_id, society_id, seq, label, latitude, longitude
  ) VALUES (
    v_pub.id, v_pub.society_id, p_seq, trim(p_label), p_latitude, p_longitude
  )
  ON CONFLICT (publication_id, seq) DO UPDATE
  SET label = EXCLUDED.label,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_publication_stop(uuid, integer, text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_publication_stop(uuid, integer, text, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_chat_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'ride_chat_messages' THEN
    SELECT count(*) INTO v_count
    FROM public.ride_chat_messages
    WHERE sender_id = NEW.sender_id AND created_at > now() - interval '10 minutes';
  ELSIF TG_TABLE_NAME = 'commute_direct_messages' THEN
    SELECT count(*) INTO v_count
    FROM public.commute_direct_messages
    WHERE sender_id = NEW.sender_id AND created_at > now() - interval '10 minutes';
  ELSE
    SELECT count(*) INTO v_count
    FROM public.commute_circle_messages
    WHERE sender_id = NEW.sender_id AND created_at > now() - interval '10 minutes';
  END IF;
  IF COALESCE(v_count, 0) >= 20 THEN
    RAISE EXCEPTION 'Too many messages. Wait a few minutes.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS direct_chat_rate_limit ON public.commute_direct_messages;
CREATE TRIGGER direct_chat_rate_limit
  BEFORE INSERT ON public.commute_direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_chat_rate_limit();

CREATE OR REPLACE FUNCTION public.cleaner_city_can_direct_chat(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.status <> 'rejected'
      AND (
        (r.host_user_id = p_a AND r.guest_user_id = p_b)
        OR (r.guest_user_id = p_a AND r.host_user_id = p_b)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.commute_circle_members a
    JOIN public.commute_circle_members b ON b.circle_id = a.circle_id
    WHERE a.user_id = p_a AND b.user_id = p_b
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_can_direct_chat(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.cleaner_city_send_direct_message(
  p_recipient uuid,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_id uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_recipient IS NULL OR p_recipient = v_uid THEN
    RAISE EXCEPTION 'Choose someone else to message';
  END IF;
  IF p_body IS NULL OR char_length(trim(p_body)) < 1 OR char_length(trim(p_body)) > 500 THEN
    RAISE EXCEPTION 'Message must be 1 to 500 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commute_blocks b
    WHERE (b.blocker_user_id = v_uid AND b.blocked_user_id = p_recipient)
       OR (b.blocker_user_id = p_recipient AND b.blocked_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Chat is hidden because one of you blocked the other';
  END IF;
  IF NOT public.cleaner_city_can_direct_chat(v_uid, p_recipient) THEN
    RAISE EXCEPTION 'Chat is limited to people on your ride or in your circle';
  END IF;
  SELECT society_id INTO v_society FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  INSERT INTO public.commute_direct_messages (society_id, sender_id, recipient_id, body)
  VALUES (v_society, v_uid, p_recipient, trim(p_body))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_send_direct_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_send_direct_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_chat_inbox()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.last_at DESC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM (
        SELECT
          'ride'::text AS kind,
          r.id AS thread_id,
          r.id AS ride_id,
          NULL::uuid AS circle_id,
          CASE WHEN r.host_user_id = v_uid THEN r.guest_user_id ELSE r.host_user_id END AS other_user_id,
          r.society_id,
          ('Ride ' || r.travel_date::text) AS title,
          COALESCE((
            SELECT m.body FROM public.ride_chat_messages m
            WHERE m.ride_id = r.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ), 'No messages yet') AS last_body,
          COALESCE((
            SELECT m.created_at FROM public.ride_chat_messages m
            WHERE m.ride_id = r.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ), r.created_at) AS last_at
        FROM public.rides r
        WHERE r.host_user_id = v_uid OR r.guest_user_id = v_uid
        UNION ALL
        SELECT
          'circle'::text,
          c.id,
          NULL::uuid,
          c.id,
          NULL::uuid,
          c.society_id,
          c.name,
          COALESCE((
            SELECT m.body FROM public.commute_circle_messages m
            WHERE m.circle_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ), 'No messages yet'),
          COALESCE((
            SELECT m.created_at FROM public.commute_circle_messages m
            WHERE m.circle_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ), c.created_at)
        FROM public.commute_circles c
        JOIN public.commute_circle_members mem ON mem.circle_id = c.id AND mem.user_id = v_uid
        UNION ALL
        SELECT
          'direct'::text,
          other_id,
          NULL::uuid,
          NULL::uuid,
          other_id,
          NULL::uuid,
          'Direct',
          last_body,
          last_at
        FROM (
          SELECT
            CASE WHEN d.sender_id = v_uid THEN d.recipient_id ELSE d.sender_id END AS other_id,
            d.body AS last_body,
            d.created_at AS last_at,
            row_number() OVER (
              PARTITION BY CASE WHEN d.sender_id = v_uid THEN d.recipient_id ELSE d.sender_id END
              ORDER BY d.created_at DESC
            ) AS rn
          FROM public.commute_direct_messages d
          WHERE d.sender_id = v_uid OR d.recipient_id = v_uid
        ) pairs
        WHERE rn = 1
      ) threads
      ORDER BY last_at DESC
      LIMIT 40
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_chat_inbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_chat_inbox() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_link_payout_account(p_account_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_account text := NULLIF(trim(COALESCE(p_account_id, '')), '');
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF v_account IS NOT NULL AND v_account !~ '^acct_[A-Za-z0-9]{6,32}$' THEN
    RAISE EXCEPTION 'Enter the Razorpay route account id from your Route dashboard (acct_...)';
  END IF;
  UPDATE public.commute_profiles
  SET razorpay_route_account_id = v_account,
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  RETURN v_account;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_link_payout_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_link_payout_account(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_mark_fuel_transferred(
  p_payment_id uuid,
  p_transfer_id text
)
RETURNS public.ride_fuel_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ride_fuel_payments;
BEGIN
  IF COALESCE(auth.role(), current_user) NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_transfer_id IS NULL OR char_length(trim(p_transfer_id)) < 4 THEN
    RAISE EXCEPTION 'Transfer id is required';
  END IF;
  UPDATE public.ride_fuel_payments
  SET payout_status = 'transferred',
      transfer_id = trim(p_transfer_id),
      transfer_error = NULL,
      transferred_at = now()
  WHERE id = p_payment_id
    AND status = 'paid'
    AND payout_status = 'payable'
    AND transfer_id IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Fuel payout is not ready to transfer';
  END IF;
  PERFORM public.cleaner_city_enqueue_notify(
    v_row.payee_id,
    'Fuel share sent',
    'Razorpay accepted the transfer to your route account. The bank timing is Razorpay''s.',
    'cleaner_city_ride_update',
    v_row.ride_id,
    v_row.society_id,
    'cc_fuel_xfer_' || v_row.id::text
  );
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_mark_fuel_transferred(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_mark_fuel_transferred(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_note_fuel_transfer(
  p_payment_id uuid,
  p_transfer_id text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), current_user) NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.ride_fuel_payments
  SET transfer_id = COALESCE(transfer_id, NULLIF(trim(COALESCE(p_transfer_id, '')), '')),
      transfer_error = left(COALESCE(p_error, 'transfer_pending'), 300)
  WHERE id = p_payment_id
    AND status = 'paid'
    AND payout_status = 'payable';
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_note_fuel_transfer(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_note_fuel_transfer(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_escalate_outbound_alert(p_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cleaner_city_outbound_alerts;
  v_next uuid;
  v_society uuid;
  v_admin record;
BEGIN
  SELECT * INTO v_row FROM public.cleaner_city_outbound_alerts WHERE id = p_alert_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Alert not found';
  END IF;
  IF COALESCE(auth.role(), current_user) NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND auth.uid() IS DISTINCT FROM v_row.user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_row.ride_id IS NOT NULL THEN
    SELECT society_id INTO v_society FROM public.rides WHERE id = v_row.ride_id;
  END IF;

  IF v_row.channel = 'sms' THEN
    SELECT id INTO v_next
    FROM public.cleaner_city_outbound_alerts
    WHERE user_id = v_row.user_id
      AND channel = 'whatsapp'
      AND destination_phone = v_row.destination_phone
      AND COALESCE(incident_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_row.incident_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_next IS NULL THEN
      INSERT INTO public.cleaner_city_outbound_alerts (
        user_id, ride_id, incident_id, channel, destination_phone, body
      ) VALUES (
        v_row.user_id, v_row.ride_id, v_row.incident_id, 'whatsapp', v_row.destination_phone, v_row.body
      )
      RETURNING id INTO v_next;
      RETURN jsonb_build_object('next', 'whatsapp', 'alert_id', v_next);
    END IF;
  END IF;

  PERFORM public.cleaner_city_enqueue_notify(
    v_row.user_id,
    'Safety alert did not send',
    'SMS and WhatsApp did not reach that phone. This is not a 112 call. Tell your contact yourself, or retry from Safety.',
    'cleaner_city_safety',
    v_row.ride_id,
    v_society,
    'cc_alert_fail_' || v_row.id::text
  );

  IF v_society IS NOT NULL THEN
    FOR v_admin IN
      SELECT DISTINCT p.id AS user_id
      FROM public.profiles p
      WHERE p.society_id = v_society
        AND public.is_society_admin(p.id, v_society)
        AND p.id <> v_row.user_id
      LIMIT 20
    LOOP
      PERFORM public.cleaner_city_enqueue_notify(
        v_admin.user_id,
        'Cleaner City alert failed',
        'An SOS or safety SMS could not be delivered. Open the ride and follow up. This is not a 112 call.',
        'cleaner_city_safety',
        v_row.ride_id,
        v_society,
        'cc_alert_admin_' || v_row.id::text || '_' || v_admin.user_id::text
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('next', 'admin', 'alert_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_escalate_outbound_alert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_escalate_outbound_alert(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_refresh_badges(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed integer;
  v_host_completed integer;
  v_host_no_show integer;
  v_in_circle boolean;
  v_verified_contact boolean;
  v_city boolean;
  v_multi boolean;
BEGIN
  IF p_user IS NULL THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO v_completed
  FROM public.rides
  WHERE status = 'completed' AND (host_user_id = p_user OR guest_user_id = p_user);
  SELECT count(*) INTO v_host_completed
  FROM public.rides
  WHERE status = 'completed' AND host_user_id = p_user;
  SELECT count(*) INTO v_host_no_show
  FROM public.rides
  WHERE status = 'no_show' AND host_user_id = p_user;
  SELECT EXISTS (
    SELECT 1 FROM public.commute_circle_members WHERE user_id = p_user
  ) INTO v_in_circle;
  SELECT EXISTS (
    SELECT 1 FROM public.commute_emergency_contacts
    WHERE user_id = p_user AND verified_at IS NOT NULL
  ) INTO v_verified_contact;
  SELECT COALESCE(open_city_matching, false) INTO v_city
  FROM public.commute_profiles
  WHERE user_id = p_user AND deleted_at IS NULL
  LIMIT 1;
  SELECT EXISTS (
    SELECT 1
    FROM public.commute_publications p
    JOIN public.commute_publication_stops s ON s.publication_id = p.id
    WHERE p.host_user_id = p_user
    GROUP BY p.id
    HAVING count(*) >= 3
  ) INTO v_multi;

  IF v_completed >= 1 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'first_ride')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_completed >= 5 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'five_rides')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_completed >= 10 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'ten_rides')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_host_completed >= 5 AND COALESCE(v_host_no_show, 0) = 0 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'reliable_host')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_in_circle AND v_completed >= 2 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'circle_rider')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_verified_contact THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'safety_ready')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_city AND v_completed >= 1 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'city_explorer')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_multi THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'multi_office')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_refresh_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_refresh_badges(uuid) TO service_role;
