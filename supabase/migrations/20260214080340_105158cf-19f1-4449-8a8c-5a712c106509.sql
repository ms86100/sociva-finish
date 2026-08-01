
-- Phase 4: Collective Escalations table
CREATE TABLE public.collective_escalations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  category TEXT NOT NULL,
  tower_id UUID REFERENCES public.project_towers(id),
  snag_count INTEGER NOT NULL DEFAULT 0,
  resident_count INTEGER NOT NULL DEFAULT 0,
  sample_photos TEXT[] DEFAULT '{}'::TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.collective_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view escalations"
  ON public.collective_escalations FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can update escalations"
  ON public.collective_escalations FOR UPDATE
  USING (is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

CREATE POLICY "Service role inserts escalations"
  ON public.collective_escalations FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_collective_escalations_society_status
  ON public.collective_escalations(society_id, status);

-- Composite index for snag grouping queries
CREATE INDEX idx_snag_tickets_society_category_status
  ON public.snag_tickets(society_id, category, status);

-- Phase 5: Society Reports table
CREATE TABLE public.society_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  report_month TEXT NOT NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  trust_score NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(society_id, report_month)
);

ALTER TABLE public.society_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view reports"
  ON public.society_reports FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Service role inserts reports"
  ON public.society_reports FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_society_reports_society_month
  ON public.society_reports(society_id, report_month);

-- Enable realtime for collective escalations
ALTER PUBLICATION supabase_realtime ADD TABLE public.collective_escalations;
