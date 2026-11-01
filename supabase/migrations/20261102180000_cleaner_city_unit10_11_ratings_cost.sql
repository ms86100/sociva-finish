-- A Cleaner City Units 10-11: ratings + fuel cost-share ledger (no settlement payout).
-- Settlement UX / Razorpay remains legally gated.

CREATE TABLE IF NOT EXISTS public.ride_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  rater_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rated_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ride_ratings_unique_pair UNIQUE (ride_id, rater_user_id)
);

ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ride_ratings_select ON public.ride_ratings;
CREATE POLICY ride_ratings_select ON public.ride_ratings
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR rater_user_id = auth.uid()
    OR rated_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ride_ratings_insert ON public.ride_ratings;
CREATE POLICY ride_ratings_insert ON public.ride_ratings
  FOR INSERT TO authenticated
  WITH CHECK (rater_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.cleaner_city_submit_rating(
  p_ride_id uuid,
  p_stars smallint,
  p_comment text DEFAULT NULL
)
RETURNS public.ride_ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_rated uuid;
  v_row public.ride_ratings;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status <> 'completed' THEN
    RAISE EXCEPTION 'Rate only after completion';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'stars must be 1-5';
  END IF;

  v_rated := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;

  INSERT INTO public.ride_ratings (ride_id, society_id, rater_user_id, rated_user_id, stars, comment)
  VALUES (
    v_ride.id, v_ride.society_id, v_uid, v_rated, p_stars,
    NULLIF(trim(COALESCE(p_comment, '')), '')
  )
  ON CONFLICT (ride_id, rater_user_id) DO UPDATE SET
    stars = EXCLUDED.stars,
    comment = EXCLUDED.comment
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'rated', 'completed', 'completed',
    jsonb_build_object('stars', p_stars)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_submit_rating(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_submit_rating(uuid, smallint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_propose_cost_share(
  p_ride_id uuid,
  p_amount_paise integer,
  p_note text DEFAULT NULL
)
RETURNS public.ride_cost_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_cost_shares;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status <> 'completed' THEN
    RAISE EXCEPTION 'Cost share only after completion';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF p_amount_paise IS NULL OR p_amount_paise < 0 THEN
    RAISE EXCEPTION 'amount_paise must be >= 0';
  END IF;

  INSERT INTO public.ride_cost_shares (
    ride_id, society_id, proposer_user_id, amount_paise, currency, status, note
  )
  VALUES (
    v_ride.id, v_ride.society_id, v_uid, p_amount_paise, 'INR', 'proposed',
    NULLIF(trim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'cost_share_proposed', 'completed', 'completed',
    jsonb_build_object('amount_paise', p_amount_paise, 'cost_share_id', v_row.id)
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_propose_cost_share(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_propose_cost_share(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_confirm_cost_share(
  p_cost_share_id uuid,
  p_accept boolean
)
RETURNS public.ride_cost_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_share public.ride_cost_shares;
  v_ride public.rides;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_share FROM public.ride_cost_shares WHERE id = p_cost_share_id FOR UPDATE;
  IF v_share.id IS NULL THEN
    RAISE EXCEPTION 'Cost share not found';
  END IF;
  IF v_share.status <> 'proposed' THEN
    RAISE EXCEPTION 'Cost share is not proposed';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_share.ride_id;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_share.proposer_user_id = v_uid THEN
    RAISE EXCEPTION 'Proposer cannot confirm their own proposal';
  END IF;

  UPDATE public.ride_cost_shares
  SET status = CASE WHEN COALESCE(p_accept, false) THEN 'accepted' ELSE 'declined' END
  WHERE id = p_cost_share_id
  RETURNING * INTO v_share;

  -- accepted stays ledger-only; no Razorpay/wallet settlement in this unit
  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid,
    CASE WHEN v_share.status = 'accepted' THEN 'cost_share_accepted' ELSE 'cost_share_declined' END,
    'completed', 'completed',
    jsonb_build_object('cost_share_id', v_share.id, 'amount_paise', v_share.amount_paise)
  );

  RETURN v_share;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_confirm_cost_share(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_confirm_cost_share(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_submit_rating IS
  'Unit 10: mutual participant ratings after completion.';
COMMENT ON FUNCTION public.cleaner_city_propose_cost_share IS
  'Unit 11: fuel cost-share ledger proposal; settlement legally gated.';
COMMENT ON FUNCTION public.cleaner_city_confirm_cost_share IS
  'Unit 11: accept/decline ledger row only - no payout wiring.';
