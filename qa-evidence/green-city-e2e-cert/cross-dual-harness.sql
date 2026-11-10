-- CERT dual-host/guest CROSS01-14 harness (service role + jwt claim.sub).
-- Safe: no live SOS/payouts. Writes CERT fixture rides only.

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
  v_pub_main uuid := 'b814b597-fb58-4e21-8ea7-0ef4a59a38d9';
  v_pub_decline uuid := 'c42be658-d947-4d3f-958e-b13b8c73fbf1';
  v_pub_cancel uuid := '640d9eda-2bf5-4af8-8350-ef8b1e7ac1a9';
  v_pub_noshow uuid := '4df7c224-8028-466d-91c1-c3281234200f';
  v_pub_race uuid := '76d6fd7e-1f75-4567-8403-c801b565b923';
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
BEGIN
  SELECT id INTO v_guest FROM auth.users WHERE email = 'cert-guest-gc@test.sociva.com';
  SELECT id INTO v_guest2 FROM auth.users WHERE email = 'cert-guest2-gc@test.sociva.com';
  IF v_guest IS NULL OR v_guest2 IS NULL THEN
    RAISE EXCEPTION 'CERT guests missing';
  END IF;

  -- Cancel any leftover open CERT rides for these guests on harness pubs
  UPDATE rides SET status = 'cancelled', updated_at = now()
  WHERE guest_user_id IN (v_guest, v_guest2)
    AND status IN ('requested','confirmed','pickup_pending','started')
    AND publication_id IN (v_pub_main, v_pub_decline, v_pub_cancel, v_pub_noshow, v_pub_race);

  UPDATE commute_publications p
  SET seats_available = CASE WHEN p.id = v_pub_race THEN 1 ELSE least(p.seats_total, 2) END,
      status = 'published',
      updated_at = now()
  WHERE p.id IN (v_pub_main, v_pub_decline, v_pub_cancel, v_pub_noshow, v_pub_race);

  -- ========== CROSS01 publish discover request accept ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT id INTO v_ride FROM public.cleaner_city_request_ride(
    v_pub_main, 'CROSS01', 13.0720, 77.7520, 12.9720, 77.5950
  );

  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride, true);

  SELECT to_jsonb(public.cleaner_city_get_ride(v_ride)) INTO v_host_view;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT to_jsonb(public.cleaner_city_get_ride(v_ride)) INTO v_guest_view;

  INSERT INTO cross_evidence VALUES (
    'CROSS01',
    CASE WHEN (v_host_view->>'status') = 'confirmed' AND (v_guest_view->>'status') = 'confirmed'
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'ride_id', v_ride,
      'host_status', v_host_view->>'status',
      'guest_status', v_guest_view->>'status',
      'notify_host', EXISTS (
        SELECT 1 FROM notification_queue n
        WHERE n.idempotency_key = 'cc_req_' || v_ride::text
           OR (n.user_id = v_host AND n.type LIKE 'cleaner_city%' AND n.created_at > now() - interval '10 minutes')
      )
    )
  );

  -- ========== CROSS05 meeting point identical ==========
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_set_meeting_point(v_ride, 'CERT Gate A', 13.0715, 77.7518);
  SELECT meeting_point_label INTO v_meet_h FROM rides WHERE id = v_ride;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT meeting_point_label INTO v_meet_g FROM rides WHERE id = v_ride;
  SELECT to_jsonb(public.cleaner_city_get_ride(v_ride))->'meeting_point_label' INTO v_guest_view;

  INSERT INTO cross_evidence VALUES (
    'CROSS05',
    CASE WHEN v_meet_h = 'CERT Gate A' AND v_meet_g = 'CERT Gate A' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('host_label', v_meet_h, 'guest_label', v_meet_g)
  );

  -- ========== CROSS06 OTP ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT (public.cleaner_city_generate_ride_otp(v_ride)->>'otp') INTO v_otp;
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  -- start_ride covers verify; keep for CROSS07
  INSERT INTO cross_evidence VALUES (
    'CROSS06',
    CASE WHEN v_otp IS NOT NULL AND length(v_otp) = 6 AND (SELECT status FROM rides WHERE id = v_ride) = 'pickup_pending'
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('otp_len', length(v_otp), 'status', (SELECT status FROM rides WHERE id = v_ride),
      'notify_host', EXISTS (
        SELECT 1 FROM notification_queue WHERE idempotency_key LIKE 'cc_otp_ready_h_' || v_ride::text || '%'
      ))
  );

  -- ========== CROSS07 start ==========
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_start_ride(v_ride, v_otp);
  INSERT INTO cross_evidence VALUES (
    'CROSS07',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride) = 'started' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'status', (SELECT status FROM rides WHERE id = v_ride),
      'notify_guest', EXISTS (
        SELECT 1 FROM notification_queue WHERE idempotency_key = 'cc_started_g_' || v_ride::text
      )
    )
  );

  -- ========== CROSS08 route change on publication ==========
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_store_route_geometry(
    v_pub_main,
    '_p~iF~ps|U_ulLnnqC_mqNvxq`@_p~iF',
    13.0713, 77.7514, 12.9716, 77.5946,
    'CERT Home', 'CERT Office via Ring', 12500, 1900, 'cert'
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

  -- ========== CROSS09 complete ==========
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_complete_ride(v_ride);
  INSERT INTO cross_evidence VALUES (
    'CROSS09',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride) = 'completed' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('status', (SELECT status FROM rides WHERE id = v_ride))
  );

  -- ========== CROSS11 fuel snapshot consistency ==========
  SELECT fuel_snapshot INTO v_snap FROM rides WHERE id = v_ride;
  IF v_snap IS NULL THEN
    PERFORM public.cleaner_city_apply_fuel_snapshot(v_ride);
    SELECT fuel_snapshot INTO v_snap FROM rides WHERE id = v_ride;
  END IF;
  INSERT INTO cross_evidence VALUES (
    'CROSS11',
    CASE WHEN v_snap IS NOT NULL
      AND (v_snap ? 'guest_share_paise')
      AND (v_snap->>'basis') IN ('equal_route','segment_route')
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'basis', v_snap->>'basis',
      'guest_share_paise', v_snap->>'guest_share_paise',
      'host_share_paise', v_snap->>'host_share_paise',
      'calc_version', v_snap->>'calc_version'
    )
  );

  -- ========== CROSS10 ratings ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT id INTO v_rating_g FROM public.cleaner_city_submit_rating(v_ride, 5::smallint, 'CROSS10 guest rates host');
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  SELECT id INTO v_rating_h FROM public.cleaner_city_submit_rating(v_ride, 5::smallint, 'CROSS10 host rates guest');
  INSERT INTO cross_evidence VALUES (
    'CROSS10',
    CASE WHEN v_rating_g IS NOT NULL AND v_rating_h IS NOT NULL
      AND (SELECT count(*) FROM ride_ratings WHERE ride_id = v_ride) >= 2
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('guest_rating', v_rating_g, 'host_rating', v_rating_h,
      'count', (SELECT count(*) FROM ride_ratings WHERE ride_id = v_ride))
  );

  -- ========== CROSS02 decline ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_decline, 'CROSS02', 13.0720, 77.7520, 12.9720, 77.5950
  );
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride2, false);
  INSERT INTO cross_evidence VALUES (
    'CROSS02',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) IN ('declined','rejected','cancelled')
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('ride_id', v_ride2, 'status', (SELECT status FROM rides WHERE id = v_ride2))
  );

  -- ========== CROSS03 guest cancel + seat release ==========
  SELECT seats_available INTO v_seats_before FROM commute_publications WHERE id = v_pub_cancel;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_cancel, 'CROSS03', 13.0720, 77.7520, 12.9720, 77.5950
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

  -- ========== CROSS13 no-show ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest2::text, true);
  SELECT id INTO v_ride2 FROM public.cleaner_city_request_ride(
    v_pub_noshow, 'CROSS13', 13.0720, 77.7520, 12.9720, 77.5950
  );
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_respond_ride_request(v_ride2, true);
  PERFORM public.cleaner_city_mark_no_show(v_ride2, 'CROSS13 CERT no-show');
  INSERT INTO cross_evidence VALUES (
    'CROSS13',
    CASE WHEN (SELECT status FROM rides WHERE id = v_ride2) = 'no_show' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('ride_id', v_ride2, 'status', (SELECT status FROM rides WHERE id = v_ride2))
  );

  -- ========== CROSS12 dispute after no-show ==========
  PERFORM set_config('request.jwt.claim.sub', v_guest2::text, true);
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

  -- ========== CROSS14 role switch ==========
  SELECT role INTO v_role_before FROM commute_profiles WHERE user_id = v_guest;
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('host', 'car', 'CERT Guest becomes Host', false);
  SELECT role INTO v_role_after FROM commute_profiles WHERE user_id = v_guest;
  -- switch host toward guest capability (both)
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('both', 'car', 'CERT Seed Co', false);
  -- restore guest to guest for later races
  PERFORM set_config('request.jwt.claim.sub', v_guest::text, true);
  PERFORM public.cleaner_city_upsert_commute_profile('guest', 'looking', 'CERT Guest Co', false);

  INSERT INTO cross_evidence VALUES (
    'CROSS14',
    CASE WHEN v_role_after IN ('host','both') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'guest_role_before', v_role_before,
      'guest_role_after_host_switch', v_role_after,
      'guest_role_restored', (SELECT role FROM commute_profiles WHERE user_id = v_guest),
      'host_role', (SELECT role FROM commute_profiles WHERE user_id = v_host),
      'prior_completed_intact', (SELECT status FROM rides WHERE id = v_ride) = 'completed'
    )
  );

  -- CROSS04 placeholder - filled by parallel REST race runner
  SELECT seats_available INTO v_seats_before FROM commute_publications WHERE id = v_pub_race;
  INSERT INTO cross_evidence VALUES (
    'CROSS04',
    'PENDING_RACE',
    jsonb_build_object('publication_id', v_pub_race, 'seats_available', v_seats_before)
  );

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  INSERT INTO cross_evidence VALUES (
    'HARNESS_ERROR', 'FAIL', jsonb_build_object('error', v_err)
  )
  ON CONFLICT (case_id) DO UPDATE SET status = 'FAIL', detail = jsonb_build_object('error', v_err);
END $$;

SELECT case_id, status, detail FROM cross_evidence ORDER BY case_id;
