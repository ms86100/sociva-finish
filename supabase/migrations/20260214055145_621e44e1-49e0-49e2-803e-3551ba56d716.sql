
-- Add trust_score column to societies
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS trust_score numeric NOT NULL DEFAULT 0;

-- Create the Society Trust Score calculation function
CREATE OR REPLACE FUNCTION public.calculate_society_trust_score(_society_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _vibrancy numeric;
  _transparency numeric;
  _governance numeric;
  _community numeric;
  _total numeric;
  _skill_count integer;
  _help_answered integer;
  _finance_entries integer;
  _milestone_entries integer;
  _dispute_total integer;
  _dispute_resolved integer;
  _bulletin_engagement integer;
BEGIN
  -- VIBRANCY (25%): Active skill listings + help requests answered in last 30 days
  SELECT COUNT(*) INTO _skill_count
  FROM skill_listings
  WHERE society_id = _society_id AND created_at > now() - interval '30 days';

  SELECT COUNT(*) INTO _help_answered
  FROM help_responses hr
  JOIN help_requests hreq ON hreq.id = hr.request_id
  WHERE hreq.society_id = _society_id AND hr.created_at > now() - interval '30 days';

  -- Cap at 10 each, normalize to 2.5
  _vibrancy := (LEAST(_skill_count, 10) + LEAST(_help_answered, 10)) / 20.0 * 2.5;

  -- TRANSPARENCY (25%): Financial entries + milestone updates in last 90 days
  SELECT COUNT(*) INTO _finance_entries
  FROM society_expenses
  WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _milestone_entries
  FROM construction_milestones
  WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  _transparency := (LEAST(_finance_entries, 20) + LEAST(_milestone_entries, 10)) / 30.0 * 2.5;

  -- GOVERNANCE (25%): Dispute resolution rate + speed
  SELECT COUNT(*) INTO _dispute_total
  FROM dispute_tickets
  WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _dispute_resolved
  FROM dispute_tickets
  WHERE society_id = _society_id AND status IN ('resolved', 'closed') AND created_at > now() - interval '90 days';

  IF _dispute_total > 0 THEN
    _governance := (_dispute_resolved::numeric / _dispute_total) * 2.5;
  ELSE
    -- No disputes = neutral score (not penalized)
    _governance := 1.25;
  END IF;

  -- COMMUNITY (25%): Bulletin engagement (posts + comments + votes in last 30 days)
  SELECT
    COALESCE(SUM(
      CASE WHEN bp.created_at > now() - interval '30 days' THEN 1 ELSE 0 END
    ), 0) +
    COALESCE((
      SELECT COUNT(*) FROM bulletin_comments bc
      JOIN bulletin_posts bp2 ON bp2.id = bc.post_id
      WHERE bp2.society_id = _society_id AND bc.created_at > now() - interval '30 days'
    ), 0) +
    COALESCE((
      SELECT COUNT(*) FROM bulletin_votes bv
      JOIN bulletin_posts bp3 ON bp3.id = bv.post_id
      WHERE bp3.society_id = _society_id AND bv.created_at > now() - interval '30 days'
    ), 0)
  INTO _bulletin_engagement
  FROM bulletin_posts bp
  WHERE bp.society_id = _society_id;

  _community := LEAST(_bulletin_engagement, 50) / 50.0 * 2.5;

  -- Total score (0-10)
  _total := ROUND(_vibrancy + _transparency + _governance + _community, 1);
  RETURN LEAST(_total, 10.0);
END;
$$;

-- Function to refresh all society trust scores (for cron)
CREATE OR REPLACE FUNCTION public.refresh_all_trust_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE societies
  SET trust_score = calculate_society_trust_score(id)
  WHERE is_active = true;
END;
$$;
