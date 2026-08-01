
-- Phase 3 & 4 Database Changes

-- 1. Add resident_id to parking_slots for vehicle-to-resident mapping (Phase 4 #18)
ALTER TABLE public.parking_slots ADD COLUMN IF NOT EXISTS resident_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.parking_slots ADD COLUMN IF NOT EXISTS flat_number text;

-- 2. Society budget planning table (Phase 4 #20)
CREATE TABLE IF NOT EXISTS public.society_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  category text NOT NULL,
  budget_amount numeric NOT NULL DEFAULT 0,
  fiscal_year text NOT NULL DEFAULT to_char(now(), 'YYYY'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, category, fiscal_year)
);

ALTER TABLE public.society_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view budgets"
  ON public.society_budgets FOR SELECT
  USING (society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Society admins can manage budgets"
  ON public.society_budgets FOR INSERT
  WITH CHECK (public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));

CREATE POLICY "Society admins can update budgets"
  ON public.society_budgets FOR UPDATE
  USING (public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));

CREATE POLICY "Society admins can delete budgets"
  ON public.society_budgets FOR DELETE
  USING (public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));

-- 3. Expense flag response columns (Phase 3 #15)
ALTER TABLE public.expense_flags ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.expense_flags ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id);

-- 4. Dispute auto-escalation trigger (Phase 4 #19)
CREATE OR REPLACE FUNCTION public.auto_escalate_overdue_disputes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auto-escalate disputes past SLA deadline that haven't been acknowledged
  UPDATE dispute_tickets
  SET status = 'escalated'
  WHERE status IN ('open', 'submitted')
    AND sla_deadline < now()
    AND acknowledged_at IS NULL;
    
  -- Notify admins about escalated disputes
  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT DISTINCT sa.user_id,
    '⚠️ Dispute SLA Breached',
    'A concern has breached its SLA deadline and has been auto-escalated.',
    'dispute',
    '/disputes',
    jsonb_build_object('type', 'sla_breach')
  FROM dispute_tickets dt
  JOIN society_admins sa ON sa.society_id = dt.society_id AND sa.deactivated_at IS NULL
  WHERE dt.status = 'escalated'
    AND dt.sla_deadline < now()
    AND dt.sla_deadline > now() - interval '1 hour'; -- Only for recently escalated
END;
$$;

-- 5. Recurring visitor generation function (Phase 3 #16)
CREATE OR REPLACE FUNCTION public.generate_recurring_visitor_entries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today text;
  _today_date date;
  _rec record;
  _otp text;
BEGIN
  _today := to_char(now(), 'Dy');
  _today_date := current_date;
  
  FOR _rec IN 
    SELECT DISTINCT ON (resident_id, visitor_name) *
    FROM visitor_entries
    WHERE is_recurring = true 
      AND status != 'cancelled'
      AND _today = ANY(recurring_days)
      AND NOT EXISTS (
        SELECT 1 FROM visitor_entries ve2
        WHERE ve2.resident_id = visitor_entries.resident_id
          AND ve2.visitor_name = visitor_entries.visitor_name
          AND ve2.expected_date = _today_date::text
      )
    ORDER BY resident_id, visitor_name, created_at DESC
  LOOP
    _otp := lpad(floor(random() * 1000000)::text, 6, '0');
    
    INSERT INTO visitor_entries (
      society_id, resident_id, visitor_name, visitor_phone, visitor_type,
      purpose, expected_date, otp_code, otp_expires_at, is_preapproved,
      is_recurring, recurring_days, flat_number, status
    ) VALUES (
      _rec.society_id, _rec.resident_id, _rec.visitor_name, _rec.visitor_phone,
      _rec.visitor_type, _rec.purpose, _today_date::text, _otp,
      _today_date + interval '1 day', true,
      false, null, _rec.flat_number, 'expected'
    );
  END LOOP;
END;
$$;

-- 6. Maintenance dues auto-income integration trigger (Phase 3 #12)
CREATE OR REPLACE FUNCTION public.sync_maintenance_payment_to_income()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    INSERT INTO society_income (society_id, source, amount, description, income_date)
    VALUES (
      NEW.society_id,
      'maintenance',
      NEW.amount,
      'Maintenance dues - ' || COALESCE(NEW.flat_number, 'Unknown') || ' (' || COALESCE(NEW.due_month, '') || ')',
      COALESCE(NEW.paid_at::date, current_date)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_maintenance_to_income
  AFTER UPDATE ON public.maintenance_dues
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_maintenance_payment_to_income();

-- 7. Snag notification trigger for builder/admin (Phase 3 #13 - SN1)
CREATE OR REPLACE FUNCTION public.notify_snag_reported()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT sa.user_id,
    '🔧 New Snag Reported',
    COALESCE(NEW.category, 'Other') || ' defect in Flat ' || COALESCE(NEW.flat_number, 'N/A') || ': ' || LEFT(NEW.description, 80),
    'snag',
    '/snags',
    jsonb_build_object('snagId', NEW.id, 'category', NEW.category)
  FROM society_admins sa
  WHERE sa.society_id = NEW.society_id
    AND sa.deactivated_at IS NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_snag_reported
  AFTER INSERT ON public.snag_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_snag_reported();

-- 8. Schedule dispute auto-escalation (runs every hour)
-- Note: uses direct SQL function call, no edge function needed

-- 9. Schedule recurring visitor generation (daily at 5:30 AM IST = midnight UTC)
-- These will be scheduled via insert tool after migration

-- 10. Milestone notification trigger (Phase 3 - CP1)
CREATE OR REPLACE FUNCTION public.notify_milestone_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT p.id,
    '🏗️ Construction Update',
    NEW.title || ' (' || NEW.completion_percentage || '% complete)',
    'milestone',
    '/progress',
    jsonb_build_object('milestoneId', NEW.id)
  FROM profiles p
  WHERE p.society_id = NEW.society_id
    AND p.verification_status = 'approved'
    AND p.id != NEW.posted_by;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_milestone_posted
  AFTER INSERT ON public.construction_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_milestone_posted();
