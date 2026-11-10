-- CERT dual-role CROSS dogfood for Green City go-live.
-- Uses jwt.claims sub switching + dense polyline that passes quality assert.

CREATE TEMP TABLE IF NOT EXISTS cross_evidence (
  case_id text PRIMARY KEY,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
DECLARE
  v_host uuid := 'fa42d0a5-95d3-441c-b6f3-28dfee15c1f8';
  v_guest uuid;
  v_guest2 uuid;
  v_vehicle uuid := 'afd62beb-fcbd-4e40-a9a9-628d95dc36fa';
  v_society uuid := 'c42eb1d9-791c-4446-b7a9-6c37c132551a';
  v_poly text := 's~wnAgypyMdC`TfC`TdC`TfC`TdC`TfC`TdC~SdC`TfC`TdC`TfC`TdC`TfC`TdC`TfC`TdC`TdC`TfC`TdC`TfC~SdC`TfC`TdC`TdC`TfC`TdC`TfC`TdC`TfC`TdC`TfC`TdC`TdC~SfC`TdC`TfC`TdC`TfC`TdC`T';
  v_origin_lat double precision := 13.0713;
  v_origin_lng double precision := 77.7514;
  v_dest_lat double precision := 13.0450;
  v_dest_lng double precision := 77.6200;
  v_pub_main uuid;
  v_pub_decline uuid;
  v_pub_cancel uuid;
  v_pub_noshow uuid;
  v_pub_race uuid;
  v_ride uuid;
  v_ride2 uuid;
  v_otp text;
  v_host_view jsonb;
  v_guest_view jsonb;
  v_snap jsonb;
  v_rating_h uuid;
  v_rating_g uuid;
  v_seats_before int;
  v_seats_after int;
  v_meet_h text;
  v_meet_g text;
  v_role_before text;
  v_role_after text;
  v_err text;
  v_day date := (timezone('Asia/Kolkata', now()))::date + 2;
BEGIN
  SELECT id INTO v_guest FROM auth.users WHERE email = 'cert-guest-gc@test.sociva.com';
  SELECT id INTO v_guest2 FROM auth.users WHERE email = 'cert-guest2-gc@test.sociva.com';
  IF v_guest IS NULL OR v_guest2 IS NULL THEN
    RAISE EXCEPTION 'CERT guests missing';
  END IF;

  -- Authenticate as host for publish seed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);

  -- Cancel leftover open CERT rides for these guests
  UPDATE rides SET status = 'cancelled', updated_at = now()
  WHERE guest_user_id IN (v_guest, v_guest2)
    AND status IN ('requested','confirmed','pickup_pending','started');

  -- Cancel prior harness pubs for host on these dates
  UPDATE commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE host_user_id = v_host
    AND travel_date BETWEEN v_day AND v_day + 6
    AND status IN ('draft','published','full');

  INSERT INTO commute_publications (
    host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
    seats_available, seats_total, status, route_polyline,
    route_distance_meters, route_duration_seconds, route_provider,
    origin_latitude, origin_longitude, destination_latitude, destination_longitude,
    origin_label, destination_label, updated_at
  ) VALUES
    (v_host, v_society, v_vehicle, v_day, 'to_office', time '08:30', 2, 3, 'published', v_poly, 12000, 1800, 'google',
     v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 'CERT Home', 'CERT Office', now()),
    (v_host, v_society, v_vehicle, v_day + 1, 'to_office', time '08:30', 2, 3, 'published', v_poly, 12000, 1800, 'google',
     v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 'CERT Home', 'CERT Office', now()),
    (v_host, v_society, v_vehicle, v_day + 2, 'to_office', time '08:30', 2, 3, 'published', v_poly, 12000, 1800, 'google',
     v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 'CERT Home', 'CERT Office', now()),
    (v_host, v_society, v_vehicle, v_day + 3, 'to_office', time '08:30', 2, 3, 'published', v_poly, 12000, 1800, 'google',
     v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 'CERT Home', 'CERT Office', now()),
    (v_host, v_society, v_vehicle, v_day + 4, 'to_office', time '08:30', 1, 3, 'published', v_poly, 12000, 1800, 'google',
     v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 'CERT Home', 'CERT Office', now())
  RETURNING id INTO v_pub_main;

  SELECT id INTO v_pub_main FROM commute_publications
  WHERE host_user_id = v_host AND travel_date = v_day AND status = 'published' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_pub_decline FROM commute_publications
  WHERE host_user_id = v_host AND travel_date = v_day + 1 AND status = 'published' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_pub_cancel FROM commute_publications
  WHERE host_user_id = v_host AND travel_date = v_day + 2 AND status = 'published' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_pub_noshow FROM commute_publications
  WHERE host_user_id = v_host AND travel_date = v_day + 3 AND status = 'published' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_pub_race FROM commute_publications
  WHERE host_user_id = v_host AND travel_date = v_day + 4 AND status = 'published' ORDER BY created_at DESC LIMIT 1;

  -- CROSS01
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_ride FROM public.cleaner_city_request_ride(
    v_pub_main, 'CROSS01', 13.0720, 77.7520, 13.0460, 77.6210
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride, true);

  SELECT to_jsonb(public.cleaner_city_get_ride(v_ride)) INTO v_host_view;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT to_jsonb(public.cleaner_city_get_ride(v_ride)) INTO v_guest_view;

  INSERT INTO cross_evidence VALUES (
    'CROSS01',
    CASE WHEN (v_host_view->>'status') = 'confirmed' AND (v_guest_view->>'status') = 'confirmed'
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'ride_id', v_ride,
      'host_status', v_host_view->>'status',
      'guest_status', v_guest_view->>'status',
      'fuel_snapshot_present', (v_host_view->'fuel_snapshot') IS NOT NULL AND (v_host_view->'fuel_snapshot') <> 'null'::jsonb
    )
  );

  -- CROSS05 meeting point
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_set_meeting_point(v_ride, 'CERT Gate A', 13.0715, 77.7518);
  SELECT meeting_point_label INTO v_meet_h FROM rides WHERE id = v_ride;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT meeting_point_label INTO v_meet_g FROM rides WHERE id = v_ride;

  INSERT INTO cross_evidence VALUES (
    'CROSS05',
    CASE WHEN v_meet_h = 'CERT Gate A' AND v_meet_g = 'CERT Gate A' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('host_label', v_meet_h, 'guest_label', v_meet_g)
  );

  -- CROSS06 OTP
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT (public.cleaner_city_generate_ride_otp(v_ride)->>'otp') INTO v_otp;
  INSERT INTO cross_evidence VALUES (
    'CROSS06',
    CASE WHEN v_otp IS NOT NULL AND length(v_otp) = 6 AND (SELECT status FROM rides WHERE id = v_ride) = 'pickup_pending'
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('otp_len', length(v_otp), 'status', (SELECT status FROM rides WHERE id = v_ride))
  );

  -- CROSS07 start
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_start_ride(v_ride, v_otp);
  INSERT INTO cross_evidence VALUES (
    'CROSS07',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride) = 'started' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('status', (SELECT status FROM rides WHERE id = v_ride))
  );

  -- CROSS08 route update with valid dense polyline
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_store_route_geometry(
    v_pub_main,
    v_poly,
    v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
    'CERT Home', 'CERT Office via Ring', 12500, 1900, 'google'
  );
  INSERT INTO cross_evidence VALUES (
    'CROSS08',
    CASE WHEN (SELECT destination_label FROM commute_publications WHERE id = v_pub_main) = 'CERT Office via Ring'
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'destination_label', (SELECT destination_label FROM commute_publications WHERE id = v_pub_main),
      'distance', (SELECT route_distance_meters FROM commute_publications WHERE id = v_pub_main)
    )
  );

  -- CROSS09 complete
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_complete_ride(v_ride);
  INSERT INTO cross_evidence VALUES (
    'CROSS09',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride) = 'completed' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('status', (SELECT status FROM rides WHERE id = v_ride))
  );

  -- CROSS11 fuel
  SELECT fuel_snapshot INTO v_snap FROM rides WHERE id = v_ride;
  IF v_snap IS NULL THEN
    PERFORM public.cleaner_city_apply_fuel_snapshot(v_ride);
    SELECT fuel_snapshot INTO v_snap FROM rides WHERE id = v_ride;
  END IF;
  INSERT INTO cross_evidence VALUES (
    'CROSS11',
    CASE WHEN v_snap IS NOT NULL
      AND ((v_snap ? 'guest_share_paise') OR (v_snap ? 'guest_shares'))
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'basis', coalesce(v_snap->>'basis', v_snap->>'mode'),
      'guest_share_paise', coalesce(v_snap->>'guest_share_paise', v_snap->'guest_shares'->>0),
      'host_share_paise', v_snap->>'host_share_paise',
      'total_fuel_paise', v_snap->>'total_fuel_paise'
    )
  );

  -- CROSS10 ratings
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_rating_g FROM public.cleaner_city_submit_rating(v_ride, 5::smallint, 'CROSS10 guest rates host');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_rating_h FROM public.cleaner_city_submit_rating(v_ride, 5::smallint, 'CROSS10 host rates guest');
  INSERT INTO cross_evidence VALUES (
    'CROSS10',
    CASE WHEN v_rating_g IS NOT NULL AND v_rating_h IS NOT NULL
      AND (SELECT count(*) FROM ride_ratings WHERE ride_id = v_ride) >= 2
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('guest_rating', v_rating_g, 'host_rating', v_rating_h,
      'count', (SELECT count(*) FROM ride_ratings WHERE ride_id = v_ride))
  );

  -- CROSS02 decline
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_decline, 'CROSS02', 13.0720, 77.7520, 13.0460, 77.6210
  );
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride2, false);
  INSERT INTO cross_evidence VALUES (
    'CROSS02',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) IN ('declined','rejected','cancelled')
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('ride_id', v_ride2, 'status', (SELECT status FROM rides WHERE id = v_ride2))
  );

  -- CROSS03 guest cancel + seat release
  SELECT seats_available INTO v_seats_before FROM commute_publications WHERE id = v_pub_cancel;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_cancel, 'CROSS03', 13.0720, 77.7520, 13.0460, 77.6210
  );
  PERFORM public.cleaner_city_cancel_ride(v_ride2, 'CROSS03 guest cancel');
  SELECT seats_available INTO v_seats_after FROM commute_publications WHERE id = v_pub_cancel;
  INSERT INTO cross_evidence VALUES (
    'CROSS03',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) = 'cancelled'
      AND v_seats_after >= v_seats_before
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'ride_id', v_ride2,
      'status', (SELECT status FROM rides WHERE id = v_ride2),
      'seats_before_request_cycle', v_seats_before,
      'seats_after_cancel', v_seats_after
    )
  );

  -- CROSS04 last-seat race (sequential conflict simulation)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_ride FROM public.cleaner_city_request_ride(
    v_pub_race, 'CROSS04a', 13.0720, 77.7520, 13.0460, 77.6210
  );
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest2::text, 'role', 'authenticated')::text, true);
    SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
      v_pub_race, 'CROSS04b', 13.0721, 77.7521, 13.0461, 77.6211
    );
  EXCEPTION WHEN OTHERS THEN
    v_ride2 := NULL;
    v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride, true);
  INSERT INTO cross_evidence VALUES (
    'CROSS04',
    CASE
      WHEN v_ride2 IS NULL THEN 'PASS'
      WHEN (SELECT status FROM rides WHERE id = v_ride) = 'confirmed'
        AND (SELECT status FROM rides WHERE id = v_ride2) IN ('requested','rejected','cancelled','declined')
        AND (SELECT seats_available FROM commute_publications WHERE id = v_pub_race) = 0
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    jsonb_build_object(
      'winner_ride', v_ride,
      'second_ride', v_ride2,
      'second_error', v_err,
      'seats_left', (SELECT seats_available FROM commute_publications WHERE id = v_pub_race),
      'winner_status', (SELECT status FROM rides WHERE id = v_ride),
      'second_status', (SELECT status FROM rides WHERE id = v_ride2)
    )
  );
  -- cleanup race winner so society stays clean
  IF v_ride IS NOT NULL THEN
    UPDATE rides SET status = 'cancelled', updated_at = now() WHERE id = v_ride AND status IN ('confirmed','requested','pickup_pending','started');
  END IF;
  IF v_ride2 IS NOT NULL THEN
    UPDATE rides SET status = 'cancelled', updated_at = now() WHERE id = v_ride2 AND status IN ('confirmed','requested','pickup_pending','started');
  END IF;

  -- CROSS13 no-show
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest2::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_noshow, 'CROSS13', 13.0720, 77.7520, 13.0460, 77.6210
  );
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride2, true);
  PERFORM public.cleaner_city_mark_no_show(v_ride2, 'CROSS13 CERT no-show');
  INSERT INTO cross_evidence VALUES (
    'CROSS13',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) = 'no_show' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('ride_id', v_ride2, 'status', (SELECT status FROM rides WHERE id = v_ride2))
  );

  -- CROSS12 dispute
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest2::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_dispute_ride(v_ride2, 'CROSS12 CERT dispute');
  INSERT INTO cross_evidence VALUES (
    'CROSS12',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) = 'disputed'
      OR EXISTS (SELECT 1 FROM ride_dispute_cases WHERE ride_id = v_ride2)
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'ride_id', v_ride2,
      'status', (SELECT status FROM rides WHERE id = v_ride2),
      'case_exists', EXISTS (SELECT 1 FROM ride_dispute_cases WHERE ride_id = v_ride2)
    )
  );

  -- CROSS14 role switch
  SELECT role INTO v_role_before FROM commute_profiles WHERE user_id = v_guest;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('host', 'car', 'CERT Guest becomes Host', false);
  SELECT role INTO v_role_after FROM commute_profiles WHERE user_id = v_guest;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('both', 'car', 'CERT Seed Co', false);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guest::text, 'role', 'authenticated')::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('guest', 'looking', 'CERT Guest Co', false);

  INSERT INTO cross_evidence VALUES (
    'CROSS14',
    CASE WHEN v_role_after IN ('host','both') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'guest_role_before', v_role_before,
      'guest_role_after_host_switch', v_role_after,
      'guest_role_restored', (SELECT role FROM commute_profiles WHERE user_id = v_guest),
      'host_role', (SELECT role FROM commute_profiles WHERE user_id = v_host)
    )
  );

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  INSERT INTO cross_evidence VALUES (
    'HARNESS_ERROR', 'FAIL', jsonb_build_object('error', v_err)
  )
  ON CONFLICT (case_id) DO UPDATE SET status = 'FAIL', detail = jsonb_build_object('error', v_err);
END $$;

SELECT case_id, status, detail FROM cross_evidence ORDER BY case_id;
