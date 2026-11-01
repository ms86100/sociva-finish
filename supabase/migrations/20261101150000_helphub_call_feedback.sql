-- HelpHub: post-call resident feedback (factual, non-punitive)

CREATE TABLE IF NOT EXISTS public.helphub_call_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.helphub_listings(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (
    outcome IN (
      'moving_forward',
      'not_the_right_fit',
      'could_not_reach',
      'number_issue',
      'no_longer_available',
      'other'
    )
  ),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helphub_call_feedback_listing
  ON public.helphub_call_feedback (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_helphub_call_feedback_society
  ON public.helphub_call_feedback (society_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_helphub_call_feedback_user
  ON public.helphub_call_feedback (from_user_id, created_at DESC);

ALTER TABLE public.helphub_call_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS helphub_call_feedback_select ON public.helphub_call_feedback;
CREATE POLICY helphub_call_feedback_select ON public.helphub_call_feedback
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR from_user_id = auth.uid()
  );

DROP POLICY IF EXISTS helphub_call_feedback_insert ON public.helphub_call_feedback;
CREATE POLICY helphub_call_feedback_insert ON public.helphub_call_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.helphub_submit_call_feedback(
  p_listing_id uuid,
  p_outcome text,
  p_note text DEFAULT NULL
)
RETURNS public.helphub_call_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing public.helphub_listings;
  v_row public.helphub_call_feedback;
  v_recent int;
  v_note text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN (
    'moving_forward',
    'not_the_right_fit',
    'could_not_reach',
    'number_issue',
    'no_longer_available',
    'other'
  ) THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;

  v_note := NULLIF(trim(COALESCE(p_note, '')), '');
  IF p_outcome = 'other' AND (v_note IS NULL OR length(v_note) < 3) THEN
    RAISE EXCEPTION 'A short note is required for Other';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 280 THEN
    RAISE EXCEPTION 'Note is too long';
  END IF;

  SELECT * INTO v_listing FROM public.helphub_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF v_listing.society_id <> public.get_user_society_id(v_uid) AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Cross-society access denied';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.helphub_call_feedback
  WHERE from_user_id = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Rate limit: too many feedback submissions';
  END IF;

  INSERT INTO public.helphub_call_feedback (
    society_id, listing_id, from_user_id, outcome, note
  )
  VALUES (
    v_listing.society_id, p_listing_id, v_uid, p_outcome, v_note
  )
  RETURNING * INTO v_row;

  PERFORM public.helphub_log(
    v_listing.society_id,
    'call_feedback',
    'helphub_call_feedback',
    v_row.id,
    jsonb_build_object('listing_id', p_listing_id, 'outcome', p_outcome)
  );

  -- Soft signal for admins when number may need a check
  IF p_outcome IN ('number_issue', 'no_longer_available') THEN
    PERFORM public.helphub_log(
      v_listing.society_id,
      'listing_needs_review',
      'helphub_listing',
      p_listing_id,
      jsonb_build_object('from_feedback', p_outcome)
    );
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.helphub_submit_call_feedback(uuid, text, text) TO authenticated;
GRANT SELECT, INSERT ON public.helphub_call_feedback TO authenticated;
