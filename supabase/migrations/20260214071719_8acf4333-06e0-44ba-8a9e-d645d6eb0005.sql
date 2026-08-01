
-- =============================================
-- Phase 1: Monitoring Infrastructure Migration
-- =============================================

-- 1. Create trigger_errors table for monitoring trigger failures
CREATE TABLE public.trigger_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trigger_name text NOT NULL,
  table_name text NOT NULL,
  error_message text NOT NULL,
  error_detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.trigger_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view trigger errors"
  ON public.trigger_errors FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "System can insert trigger errors"
  ON public.trigger_errors FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_trigger_errors_created_at ON public.trigger_errors (created_at DESC);
CREATE INDEX idx_trigger_errors_trigger_name ON public.trigger_errors (trigger_name);

-- 2. Replace 7 log_*_activity() functions with error-handling versions

CREATE OR REPLACE FUNCTION public.log_expense_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, reference_id, reference_type)
    VALUES (NEW.society_id, NEW.added_by, 'expense_added', NEW.title, NEW.id, 'society_expenses');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_expense_activity', 'society_expenses', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_dispute_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
    VALUES (NEW.society_id, NEW.submitted_by, 'dispute_created', 'New dispute: ' || NEW.category, NEW.description, NEW.id, 'dispute_tickets');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_dispute_activity', 'dispute_tickets', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_document_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type)
    VALUES (NEW.society_id, NEW.uploaded_by, 'document_uploaded', NEW.title, NEW.description, NEW.id, 'project_documents');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_document_activity', 'project_documents', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_broadcast_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, is_system)
    VALUES (NEW.society_id, NEW.sent_by, 'broadcast_sent', NEW.title, NEW.body, NEW.id, 'emergency_broadcasts', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_broadcast_activity', 'emergency_broadcasts', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_answer_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _society_id uuid;
  _question_text text;
BEGIN
  BEGIN
    SELECT society_id, question_text INTO _society_id, _question_text
    FROM public.project_questions WHERE id = NEW.question_id;
    
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, reference_id, reference_type)
    VALUES (_society_id, NEW.answered_by, 'question_answered', 'Answer posted: ' || LEFT(_question_text, 80), NEW.question_id, 'project_questions');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_answer_activity', 'project_answers', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_milestone_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, tower_id)
    VALUES (NEW.society_id, NEW.posted_by, 'milestone_posted', NEW.title, NEW.description, NEW.id, 'construction_milestones', NEW.tower_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_milestone_activity', 'construction_milestones', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_snag_activity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, actor_id, activity_type, title, description, reference_id, reference_type, tower_id)
    VALUES (NEW.society_id, NEW.reported_by, 'snag_reported', NEW.title, NEW.description, NEW.id, 'snag_tickets', NEW.tower_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (trigger_name, table_name, error_message, error_detail)
    VALUES ('log_snag_activity', 'snag_tickets', SQLERRM, SQLSTATE);
  END;
  RETURN NEW;
END;
$function$;

-- 3. Create audit trigger for order status changes
CREATE OR REPLACE FUNCTION public.trg_audit_order_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_log (actor_id, action, target_type, target_id, society_id, metadata)
    VALUES (
      auth.uid(),
      'order_status_changed',
      'order',
      NEW.id,
      NEW.society_id,
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_audit_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_order_status();

-- 4. Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
