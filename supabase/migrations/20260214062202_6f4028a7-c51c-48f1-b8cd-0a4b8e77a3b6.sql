
-- ============================================
-- 1. SOCIETY ACTIVITY FEED TABLE
-- ============================================
CREATE TABLE public.society_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  title text NOT NULL,
  description text,
  reference_id uuid,
  reference_type text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_society_activity_society_created ON public.society_activity(society_id, created_at DESC);

ALTER TABLE public.society_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view activity"
  ON public.society_activity FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "System and admins can insert activity"
  ON public.society_activity FOR INSERT
  WITH CHECK (
    (society_id = get_user_society_id(auth.uid()) AND actor_id = auth.uid())
    OR is_admin(auth.uid())
  );

-- Enable realtime for activity feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.society_activity;

-- ============================================
-- 2. USER NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE public.user_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  reference_id text,
  reference_path text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notifications_user_read ON public.user_notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.user_notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.user_notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications"
  ON public.user_notifications FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 3. MAINTENANCE DUES TABLE
-- ============================================
CREATE TABLE public.maintenance_dues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_identifier text NOT NULL,
  resident_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  month text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  paid_date date,
  receipt_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_dues_society_month ON public.maintenance_dues(society_id, month DESC);

ALTER TABLE public.maintenance_dues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own dues"
  ON public.maintenance_dues FOR SELECT
  USING (
    resident_id = auth.uid()
    OR (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()))
  );

CREATE POLICY "Admins can insert dues"
  ON public.maintenance_dues FOR INSERT
  WITH CHECK (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Admins can update dues"
  ON public.maintenance_dues FOR UPDATE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

CREATE POLICY "Admins can delete dues"
  ON public.maintenance_dues FOR DELETE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));

-- ============================================
-- 4. ACTIVITY TRIGGERS
-- ============================================

-- Trigger function for milestones
CREATE OR REPLACE FUNCTION public.log_milestone_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
  VALUES (NEW.society_id, NEW.posted_by, 'milestone_posted', NEW.title, NEW.description, NEW.id, 'construction_milestones');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_milestone_activity
  AFTER INSERT ON public.construction_milestones
  FOR EACH ROW EXECUTE FUNCTION public.log_milestone_activity();

-- Trigger function for expenses
CREATE OR REPLACE FUNCTION public.log_expense_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, reference_id, reference_type)
  VALUES (NEW.society_id, NEW.added_by, 'expense_added', NEW.title, NEW.id, 'society_expenses');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expense_activity
  AFTER INSERT ON public.society_expenses
  FOR EACH ROW EXECUTE FUNCTION public.log_expense_activity();

-- Trigger function for disputes
CREATE OR REPLACE FUNCTION public.log_dispute_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
  VALUES (NEW.society_id, NEW.submitted_by, 'dispute_created', 'New dispute: ' || NEW.category, NEW.description, NEW.id, 'dispute_tickets');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dispute_activity
  AFTER INSERT ON public.dispute_tickets
  FOR EACH ROW EXECUTE FUNCTION public.log_dispute_activity();

-- Trigger function for snags
CREATE OR REPLACE FUNCTION public.log_snag_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
  VALUES (NEW.society_id, NEW.reported_by, 'snag_reported', NEW.title, NEW.description, NEW.id, 'snag_tickets');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snag_activity
  AFTER INSERT ON public.snag_tickets
  FOR EACH ROW EXECUTE FUNCTION public.log_snag_activity();

-- Trigger function for documents
CREATE OR REPLACE FUNCTION public.log_document_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
  VALUES (NEW.society_id, NEW.uploaded_by, 'document_uploaded', NEW.title, NEW.description, NEW.id, 'project_documents');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_activity
  AFTER INSERT ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_document_activity();

-- Trigger function for broadcasts
CREATE OR REPLACE FUNCTION public.log_broadcast_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, is_system)
  VALUES (NEW.society_id, NEW.sent_by, 'broadcast_sent', NEW.title, NEW.body, NEW.id, 'emergency_broadcasts', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_broadcast_activity
  AFTER INSERT ON public.emergency_broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.log_broadcast_activity();

-- Trigger function for questions answered
CREATE OR REPLACE FUNCTION public.log_answer_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _society_id uuid;
  _question_text text;
BEGIN
  SELECT society_id, question_text INTO _society_id, _question_text
  FROM public.project_questions WHERE id = NEW.question_id;
  
  INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, reference_id, reference_type)
  VALUES (_society_id, NEW.answered_by, 'question_answered', 'Answer posted: ' || LEFT(_question_text, 80), NEW.question_id, 'project_questions');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_answer_activity
  AFTER INSERT ON public.project_answers
  FOR EACH ROW EXECUTE FUNCTION public.log_answer_activity();
