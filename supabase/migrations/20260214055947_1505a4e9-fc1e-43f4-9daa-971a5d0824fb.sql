
-- =====================================================
-- PHASE 1: Tower-Wise Progress + Delay Intelligence
-- =====================================================

-- Project Towers table
CREATE TABLE public.project_towers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_floors INTEGER NOT NULL DEFAULT 0,
  expected_completion DATE,
  revised_completion DATE,
  delay_reason TEXT,
  delay_category TEXT CHECK (delay_category IN ('weather', 'material_shortage', 'government_approval', 'labour', 'other')),
  current_stage TEXT NOT NULL DEFAULT 'foundation',
  current_percentage INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_towers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view towers"
  ON public.project_towers FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can insert towers"
  ON public.project_towers FOR INSERT
  WITH CHECK (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Admins can update towers"
  ON public.project_towers FOR UPDATE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Admins can delete towers"
  ON public.project_towers FOR DELETE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

-- Add tower_id to construction_milestones (nullable, backward-compatible)
ALTER TABLE public.construction_milestones
  ADD COLUMN tower_id UUID REFERENCES public.project_towers(id) ON DELETE SET NULL;

-- =====================================================
-- PHASE 2: Document Vault
-- =====================================================

CREATE TABLE public.project_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  tower_id UUID REFERENCES public.project_towers(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view documents"
  ON public.project_documents FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can insert documents"
  ON public.project_documents FOR INSERT
  WITH CHECK (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()) AND uploaded_by = auth.uid());

CREATE POLICY "Admins can update documents"
  ON public.project_documents FOR UPDATE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Admins can delete documents"
  ON public.project_documents FOR DELETE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

-- =====================================================
-- PHASE 3: Structured Q&A
-- =====================================================

CREATE TABLE public.project_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  asked_by UUID NOT NULL REFERENCES public.profiles(id),
  category TEXT NOT NULL DEFAULT 'general',
  question_text TEXT NOT NULL,
  is_answered BOOLEAN NOT NULL DEFAULT false,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view questions"
  ON public.project_questions FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Society members can ask questions"
  ON public.project_questions FOR INSERT
  WITH CHECK (society_id = get_user_society_id(auth.uid()) AND asked_by = auth.uid());

CREATE POLICY "Admins can update questions (pin/mark answered)"
  ON public.project_questions FOR UPDATE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Authors and admins can delete questions"
  ON public.project_questions FOR DELETE
  USING (asked_by = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid())));

CREATE TABLE public.project_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID NOT NULL REFERENCES public.project_questions(id) ON DELETE CASCADE,
  answered_by UUID NOT NULL REFERENCES public.profiles(id),
  answer_text TEXT NOT NULL,
  is_official BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view answers"
  ON public.project_answers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_questions pq
    WHERE pq.id = project_answers.question_id
    AND (pq.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
  ));

CREATE POLICY "Society members can post answers"
  ON public.project_answers FOR INSERT
  WITH CHECK (answered_by = auth.uid() AND EXISTS (
    SELECT 1 FROM project_questions pq
    WHERE pq.id = project_answers.question_id
    AND pq.society_id = get_user_society_id(auth.uid())
  ));

CREATE POLICY "Admins can update answers"
  ON public.project_answers FOR UPDATE
  USING (answered_by = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Authors and admins can delete answers"
  ON public.project_answers FOR DELETE
  USING (answered_by = auth.uid() OR is_admin(auth.uid()));

-- =====================================================
-- PHASE 4: Snag Tickets
-- =====================================================

CREATE TABLE public.snag_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  tower_id UUID REFERENCES public.project_towers(id) ON DELETE SET NULL,
  flat_number TEXT NOT NULL,
  reported_by UUID NOT NULL REFERENCES public.profiles(id),
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  photo_urls TEXT[] DEFAULT '{}'::TEXT[],
  status TEXT NOT NULL DEFAULT 'reported',
  sla_deadline TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  assigned_to_name TEXT,
  acknowledged_at TIMESTAMPTZ,
  fixed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.snag_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporters can view own snag tickets"
  ON public.snag_tickets FOR SELECT
  USING (reported_by = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid())));

CREATE POLICY "Society members can create snag tickets"
  ON public.snag_tickets FOR INSERT
  WITH CHECK (reported_by = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Admins can update snag tickets"
  ON public.snag_tickets FOR UPDATE
  USING (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR reported_by = auth.uid()));

-- =====================================================
-- PHASE 5: Upgrade Trust Score
-- =====================================================

CREATE OR REPLACE FUNCTION public.calculate_society_trust_score(_society_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _doc_count integer;
  _qa_total integer;
  _qa_answered integer;
  _delay_explained integer;
  _tower_total integer;
  _dispute_total integer;
  _dispute_resolved integer;
  _snag_total integer;
  _snag_resolved integer;
  _bulletin_engagement integer;
BEGIN
  -- VIBRANCY (25%): Active skill listings + help requests answered in last 30 days
  SELECT COUNT(*) INTO _skill_count
  FROM skill_listings WHERE society_id = _society_id AND created_at > now() - interval '30 days';

  SELECT COUNT(*) INTO _help_answered
  FROM help_responses hr
  JOIN help_requests hreq ON hreq.id = hr.request_id
  WHERE hreq.society_id = _society_id AND hr.created_at > now() - interval '30 days';

  _vibrancy := (LEAST(_skill_count, 10) + LEAST(_help_answered, 10)) / 20.0 * 2.5;

  -- TRANSPARENCY (25%): Financial entries + milestones + documents + delay explanations + Q&A response rate
  SELECT COUNT(*) INTO _finance_entries
  FROM society_expenses WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _milestone_entries
  FROM construction_milestones WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _doc_count
  FROM project_documents WHERE society_id = _society_id;

  SELECT COUNT(*) INTO _tower_total FROM project_towers WHERE society_id = _society_id;
  SELECT COUNT(*) INTO _delay_explained
  FROM project_towers WHERE society_id = _society_id AND revised_completion IS NOT NULL AND delay_reason IS NOT NULL;

  SELECT COUNT(*) INTO _qa_total FROM project_questions WHERE society_id = _society_id;
  SELECT COUNT(*) INTO _qa_answered FROM project_questions WHERE society_id = _society_id AND is_answered = true;

  _transparency := (
    LEAST(_finance_entries, 20) / 20.0 * 0.5 +
    LEAST(_milestone_entries, 10) / 10.0 * 0.5 +
    LEAST(_doc_count, 10) / 10.0 * 0.5 +
    CASE WHEN _tower_total > 0 THEN (_delay_explained::numeric / _tower_total) * 0.5 ELSE 0.25 END +
    CASE WHEN _qa_total > 0 THEN (_qa_answered::numeric / _qa_total) * 0.5 ELSE 0.25 END
  ) * 2.5;

  -- GOVERNANCE (25%): Dispute + snag resolution rate
  SELECT COUNT(*) INTO _dispute_total
  FROM dispute_tickets WHERE society_id = _society_id AND created_at > now() - interval '90 days';
  SELECT COUNT(*) INTO _dispute_resolved
  FROM dispute_tickets WHERE society_id = _society_id AND status IN ('resolved', 'closed') AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _snag_total
  FROM snag_tickets WHERE society_id = _society_id AND created_at > now() - interval '90 days';
  SELECT COUNT(*) INTO _snag_resolved
  FROM snag_tickets WHERE society_id = _society_id AND status IN ('fixed', 'verified', 'closed') AND created_at > now() - interval '90 days';

  IF (_dispute_total + _snag_total) > 0 THEN
    _governance := ((_dispute_resolved + _snag_resolved)::numeric / (_dispute_total + _snag_total)) * 2.5;
  ELSE
    _governance := 1.25;
  END IF;

  -- COMMUNITY (25%): Bulletin engagement
  SELECT
    COALESCE(SUM(CASE WHEN bp.created_at > now() - interval '30 days' THEN 1 ELSE 0 END), 0) +
    COALESCE((SELECT COUNT(*) FROM bulletin_comments bc JOIN bulletin_posts bp2 ON bp2.id = bc.post_id WHERE bp2.society_id = _society_id AND bc.created_at > now() - interval '30 days'), 0) +
    COALESCE((SELECT COUNT(*) FROM bulletin_votes bv JOIN bulletin_posts bp3 ON bp3.id = bv.post_id WHERE bp3.society_id = _society_id AND bv.created_at > now() - interval '30 days'), 0)
  INTO _bulletin_engagement
  FROM bulletin_posts bp WHERE bp.society_id = _society_id;

  _community := LEAST(_bulletin_engagement, 50) / 50.0 * 2.5;

  _total := ROUND(_vibrancy + _transparency + _governance + _community, 1);
  RETURN LEAST(_total, 10.0);
END;
$function$;
