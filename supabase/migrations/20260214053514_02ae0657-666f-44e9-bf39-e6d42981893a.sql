
-- Create a function to calculate trust score from endorsements + seller reviews
CREATE OR REPLACE FUNCTION public.calculate_trust_score(_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _endorsement_score numeric;
  _review_score numeric;
  _total_score numeric;
BEGIN
  -- Get endorsement count across all skills
  SELECT COALESCE(SUM(endorsement_count), 0) INTO _endorsement_score
  FROM skill_listings WHERE user_id = _user_id;

  -- Get average seller review rating (if user is a seller)
  SELECT COALESCE(AVG(r.rating), 0) INTO _review_score
  FROM reviews r
  JOIN seller_profiles sp ON sp.id = r.seller_id
  WHERE sp.user_id = _user_id AND r.is_hidden = false;

  -- Trust score = endorsements + (avg_review * 2) to weight reviews
  _total_score := _endorsement_score + (_review_score * 2);
  RETURN _total_score;
END;
$$;

-- Update the endorsement trigger to also factor in seller reviews
CREATE OR REPLACE FUNCTION public.update_endorsement_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT user_id INTO _user_id FROM skill_listings WHERE id = NEW.skill_id;
    UPDATE public.skill_listings SET 
      endorsement_count = endorsement_count + 1,
      trust_score = calculate_trust_score(_user_id)
    WHERE id = NEW.skill_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT user_id INTO _user_id FROM skill_listings WHERE id = OLD.skill_id;
    UPDATE public.skill_listings SET 
      endorsement_count = GREATEST(endorsement_count - 1, 0),
      trust_score = calculate_trust_score(_user_id)
    WHERE id = OLD.skill_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
