
-- 1. Add resolution_note to dispute_tickets and snag_tickets
ALTER TABLE public.dispute_tickets ADD COLUMN IF NOT EXISTS resolution_note text;
ALTER TABLE public.snag_tickets ADD COLUMN IF NOT EXISTS resolution_note text;

-- 2. Create expense_views table for social proof
CREATE TABLE public.expense_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES public.society_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(expense_id, user_id)
);

ALTER TABLE public.expense_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expense views in their society"
ON public.expense_views FOR SELECT
USING (EXISTS (
  SELECT 1 FROM society_expenses se
  WHERE se.id = expense_views.expense_id
  AND se.society_id = get_user_society_id(auth.uid())
));

CREATE POLICY "Users can record their own views"
ON public.expense_views FOR INSERT
WITH CHECK (user_id = auth.uid());

-- 3. Create society_report_cards table for monthly reports
CREATE TABLE public.society_report_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  month text NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, month)
);

ALTER TABLE public.society_report_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view their reports"
ON public.society_report_cards FOR SELECT
USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "System can insert reports"
ON public.society_report_cards FOR INSERT
WITH CHECK (is_admin(auth.uid()));

-- 4. Add tower_id to society_activity for tower-aware filtering
ALTER TABLE public.society_activity ADD COLUMN IF NOT EXISTS tower_id uuid REFERENCES public.project_towers(id);

-- 5. Update milestone activity trigger to include tower_id
CREATE OR REPLACE FUNCTION public.log_milestone_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, tower_id)
  VALUES (NEW.society_id, NEW.posted_by, 'milestone_posted', NEW.title, NEW.description, NEW.id, 'construction_milestones', NEW.tower_id);
  RETURN NEW;
END;
$$;

-- 6. Update snag activity trigger to include tower_id
CREATE OR REPLACE FUNCTION public.log_snag_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, tower_id)
  VALUES (NEW.society_id, NEW.reported_by, 'snag_reported', NEW.title, NEW.description, NEW.id, 'snag_tickets', NEW.tower_id);
  RETURN NEW;
END;
$$;

-- 7. Enable realtime for expense_views
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_views;
