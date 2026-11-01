-- Dispute: notify society admins when opened.
-- Appeal: only the other participant; notify opener + admins.

CREATE OR REPLACE FUNCTION public.cleaner_city_dispute_ride(p_ride_id uuid, p_note text DEFAULT NULL)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_prior text;
  v_admin record;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('no_show', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only a finished, cancelled, or no-show ride can be disputed';
  END IF;
  IF p_note IS NULL OR char_length(trim(p_note)) < 4 THEN
    RAISE EXCEPTION 'Add a short note about what went wrong';
  END IF;
  v_prior := v_ride.status;
  UPDATE public.rides
  SET status = 'disputed', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;
  INSERT INTO public.ride_dispute_cases (
    ride_id, society_id, opened_by, prior_status, note, status
  ) VALUES (
    v_ride.id, v_ride.society_id, v_uid, v_prior,
    NULLIF(trim(COALESCE(p_note, '')), ''), 'open'
  );
  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'disputed', v_prior, 'disputed',
    jsonb_build_object('note', NULLIF(trim(COALESCE(p_note, '')), ''))
  );
  PERFORM public.cleaner_city_enqueue_notify(
    CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END,
    'Ride problem reported',
    'Your commute partner reported a problem. You can tell your side, and a society admin will review.',
    'cleaner_city_ride_update',
    v_ride.id,
    v_ride.society_id,
    'cc_dispute_' || v_ride.id::text
  );
  FOR v_admin IN
    SELECT DISTINCT p.id AS user_id
    FROM public.profiles p
    WHERE p.society_id = v_ride.society_id
      AND public.is_society_admin(p.id, v_ride.society_id)
      AND p.id <> v_uid
    LIMIT 20
  LOOP
    PERFORM public.cleaner_city_enqueue_notify(
      v_admin.user_id,
      'Cleaner City dispute - admin',
      'A commute dispute needs review in Admin.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_dispute_admin_' || v_ride.id::text || '_' || v_admin.user_id::text
    );
  END LOOP;
  RETURN v_ride;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_appeal_dispute(
  p_ride_id uuid,
  p_note text
)
RETURNS public.ride_dispute_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_case public.ride_dispute_cases;
  v_ride public.rides;
  v_admin record;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_note IS NULL OR char_length(trim(p_note)) < 4 THEN
    RAISE EXCEPTION 'Add a short note with your side of the story';
  END IF;
  SELECT * INTO v_case FROM public.ride_dispute_cases WHERE ride_id = p_ride_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'No dispute to respond to';
  END IF;
  IF NOT public.cleaner_city_is_ride_participant(p_ride_id, v_uid) THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_case.opened_by = v_uid THEN
    RAISE EXCEPTION 'You already reported this. A society admin will review.';
  END IF;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already reviewed or closed';
  END IF;

  UPDATE public.ride_dispute_cases
  SET status = 'appealed',
      appeal_note = trim(p_note),
      appeal_by = v_uid,
      appealed_at = now()
  WHERE id = v_case.id
  RETURNING * INTO v_case;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

  PERFORM public.cleaner_city_enqueue_notify(
    v_case.opened_by,
    'Partner replied to the dispute',
    'The other person told their side. A society admin will decide.',
    'cleaner_city_ride_update',
    p_ride_id,
    COALESCE(v_ride.society_id, v_case.society_id),
    'cc_dispute_appeal_' || v_case.id::text
  );

  FOR v_admin IN
    SELECT DISTINCT p.id AS user_id
    FROM public.profiles p
    WHERE p.society_id = COALESCE(v_ride.society_id, v_case.society_id)
      AND public.is_society_admin(p.id, p.society_id)
      AND p.id <> v_uid
    LIMIT 20
  LOOP
    PERFORM public.cleaner_city_enqueue_notify(
      v_admin.user_id,
      'Cleaner City dispute reply - admin',
      'Both sides have spoken. Review the dispute in Admin.',
      'cleaner_city_ride_update',
      p_ride_id,
      COALESCE(v_ride.society_id, v_case.society_id),
      'cc_dispute_appeal_admin_' || v_case.id::text || '_' || v_admin.user_id::text
    );
  END LOOP;

  RETURN v_case;
END;
$$;
