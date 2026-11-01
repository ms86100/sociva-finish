import { readFileSync, appendFileSync } from 'node:fs';

const root = 'supabase/migrations';
let find = readFileSync(
  `${root}/20261102211000_cleaner_city_gaps_part2_matching_safety_circles.sql`,
  'utf8',
);
const start = find.indexOf('CREATE OR REPLACE FUNCTION public.cleaner_city_find_matches(');
const end = find.indexOf('-- ---------------------------------------------------------------------------\n-- Meeting point', start);
if (start < 0 || end < 0) throw new Error(`find bounds ${start} ${end}`);
find = find.slice(start, end);
const dirCheck = `IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;`;
if (!find.includes(dirCheck)) throw new Error('dir check missing');
find = find.replace(
  dirCheck,
  `${dirCheck}
  IF p_guest_pickup_lat IS NULL OR p_guest_pickup_lng IS NULL
     OR p_guest_dest_lat IS NULL OR p_guest_dest_lng IS NULL THEN
    RAISE EXCEPTION 'Pickup and destination pins are required';
  END IF;
  SELECT COALESCE(circle_only_matching, false) INTO v_circle_only
  FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;`,
);
if (!find.includes('v_same_circle boolean;')) throw new Error('decl missing');
find = find.replace(
  'v_same_circle boolean;',
  `v_same_circle boolean;
  v_circle_only boolean := false;
  v_road_overlap numeric;
  v_no_shows integer := 0;`,
);
const marker = `    SELECT EXISTS (
      SELECT 1
      FROM public.commute_circle_members a`;
const insert = `    IF r.route_polyline IS NOT NULL THEN
      v_road_overlap := public.cleaner_city_polyline_overlap_pct(
        r.route_polyline,
        p_guest_pickup_lat, p_guest_pickup_lng,
        p_guest_dest_lat, p_guest_dest_lng
      );
      IF v_road_overlap IS NOT NULL THEN
        IF v_road_overlap < v_min_overlap THEN
          IF v_hard_overlap THEN CONTINUE; END IF;
          v_reasons := array_append(v_reasons, 'road_overlap_below_target');
          v_score := v_score - 5;
        ELSE
          v_reasons := array_append(v_reasons, 'road_polyline_overlap');
          v_score := v_score + 15;
        END IF;
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.commute_circle_members a`;
if (!find.includes(marker)) throw new Error('circle marker missing');
find = find.replace(marker, insert);
find = find.replace(
  `    IF v_same_circle THEN
      v_reasons := array_append(v_reasons, 'shared_circle');
      v_score := v_score + 30;
    END IF;`,
  `    IF v_same_circle THEN
      v_reasons := array_append(v_reasons, 'shared_circle');
      v_score := v_score + 30;
    ELSIF COALESCE(v_circle_only, false) THEN
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_no_shows
    FROM public.rides ns
    WHERE ns.host_user_id = r.host_user_id AND ns.status = 'no_show';`,
);
find = find.replace(
  `      'shared_circle', v_same_circle,
      'score', round(v_score, 1),`,
  `      'shared_circle', v_same_circle,
      'pickup_walk_meters', v_pickup_dev_m,
      'host_no_show_count', v_no_shows,
      'road_overlap_pct', v_road_overlap,
      'score', round(v_score, 1),`,
);

let ride = readFileSync(`${root}/20261102233000_cleaner_city_guest_booking_lock.sql`, 'utf8');
const rs = ride.indexOf('CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(');
const re = ride.indexOf('-- 2-arg overload', rs);
if (rs < 0 || re < 0) throw new Error('ride bounds');
ride = ride.slice(rs, re);
const lockLine = '  PERFORM public.cleaner_city_lock_guest_booking(v_uid, v_pub.travel_date, v_pub.direction);';
if (!ride.includes(lockLine)) throw new Error('lock missing');
ride = ride.replace(
  lockLine,
  `${lockLine}

  IF EXISTS (
    SELECT 1 FROM public.commute_seat_offers o
    WHERE o.publication_id = p_publication_id
      AND o.status = 'open'
      AND o.expires_at > now()
      AND o.user_id <> v_uid
  ) THEN
    RAISE EXCEPTION 'This seat is held for a waitlist offer';
  END IF;`,
);
if (!ride.includes('  RETURNING * INTO v_ride;')) throw new Error('returning missing');
ride = ride.replace(
  '  RETURNING * INTO v_ride;',
  `  RETURNING * INTO v_ride;

  UPDATE public.commute_seat_offers
  SET status = 'accepted', updated_at = now()
  WHERE publication_id = p_publication_id
    AND user_id = v_uid
    AND status = 'open';`,
);

let timeouts = readFileSync(`${root}/20261102230000_cleaner_city_phase1_remediation.sql`, 'utf8');
const ts = timeouts.indexOf('CREATE OR REPLACE FUNCTION public.cleaner_city_process_timeouts()');
const te = timeouts.indexOf('CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(', ts);
if (ts < 0 || te < 0) throw new Error(`timeout bounds ${ts} ${te}`);
timeouts = timeouts.slice(ts, te);
timeouts = timeouts.replace(
  'v_req integer := 0;\n  v_pick integer := 0;',
  'v_req integer := 0;\n  v_pick integer := 0;\n  v_offers integer := 0;',
);
timeouts = timeouts.replace(
  `  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;`,
  `  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_offers := public.cleaner_city_expire_seat_offers();`,
);
timeouts = timeouts.replace(
  `RETURN jsonb_build_object('expired_requests', v_req, 'pickup_no_shows', v_pick);`,
  `RETURN jsonb_build_object('expired_requests', v_req, 'pickup_no_shows', v_pick, 'expired_offers', v_offers);`,
);

appendFileSync(
  `${root}/20261102240000_cleaner_city_five_feature_gaps.sql`,
  `\n${find}\n${ride}\n${timeouts}`,
);
console.log('appended', find.length, ride.length, timeouts.length);
