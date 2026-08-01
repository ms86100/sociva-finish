
-- 1. Add delivery_code column if not exists (it may already exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_assignments' AND column_name = 'delivery_code') THEN
    ALTER TABLE public.delivery_assignments ADD COLUMN delivery_code TEXT;
  END IF;
END $$;

-- 2. Function to generate delivery code when order becomes ready/picked_up
CREATE OR REPLACE FUNCTION public.generate_delivery_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  _code TEXT;
BEGIN
  -- Only trigger on status change to ready or picked_up
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('ready', 'picked_up') THEN RETURN NEW; END IF;
  
  -- Check if delivery assignment exists and needs a code
  UPDATE delivery_assignments
  SET delivery_code = UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6)),
      otp_expires_at = NOW() + INTERVAL '4 hours'
  WHERE order_id = NEW.id
    AND delivery_code IS NULL;
  
  RETURN NEW;
END;
$func$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS trg_generate_delivery_code ON orders;
CREATE TRIGGER trg_generate_delivery_code
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_delivery_code();

-- 3. Function to notify resident when visitor is checked in
CREATE OR REPLACE FUNCTION public.notify_visitor_checked_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'checked_in' THEN RETURN NEW; END IF;
  IF NEW.resident_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.resident_id,
    '🚪 Visitor Arrived',
    COALESCE(NEW.visitor_name, 'A visitor') || ' has arrived at the gate' || 
    CASE WHEN NEW.flat_number IS NOT NULL THEN ' for Flat ' || NEW.flat_number ELSE '' END || '.',
    'visitor',
    '/visitors',
    jsonb_build_object('visitorId', NEW.id, 'visitorName', NEW.visitor_name)
  );

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_notify_visitor_checked_in ON visitor_entries;
CREATE TRIGGER trg_notify_visitor_checked_in
  AFTER UPDATE ON visitor_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_visitor_checked_in();

-- 4. Function to notify resident when parcel is logged
CREATE OR REPLACE FUNCTION public.notify_parcel_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  IF NEW.resident_id IS NULL THEN RETURN NEW; END IF;
  -- Only notify if logged by someone else (guard)
  IF NEW.logged_by IS NOT NULL AND NEW.logged_by != NEW.resident_id THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.resident_id,
      '📦 Parcel Received',
      'A parcel from ' || COALESCE(NEW.courier_name, 'unknown courier') || ' has arrived at the gate.',
      'parcel',
      '/parcels',
      jsonb_build_object('parcelId', NEW.id, 'courier', NEW.courier_name)
    );
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_notify_parcel_received ON parcel_entries;
CREATE TRIGGER trg_notify_parcel_received
  AFTER INSERT ON parcel_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_parcel_received();

-- 5. Function to notify on maintenance due approaching (via cron, not trigger)
CREATE OR REPLACE FUNCTION public.notify_upcoming_maintenance_dues()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  INSERT INTO notification_queue (user_id, title, body, type, reference_path)
  SELECT 
    md.resident_id,
    '🏠 Maintenance Due Reminder',
    'Your maintenance dues of ₹' || md.amount::TEXT || ' for ' || md.month || ' is pending. Pay now to avoid late fees.',
    'maintenance',
    '/maintenance'
  FROM maintenance_dues md
  WHERE md.status = 'pending'
    AND md.resident_id IS NOT NULL
    -- Only notify once per week for same due
    AND NOT EXISTS (
      SELECT 1 FROM notification_queue nq
      WHERE nq.user_id = md.resident_id
        AND nq.type = 'maintenance'
        AND nq.created_at > NOW() - INTERVAL '7 days'
        AND nq.body LIKE '%' || md.month || '%'
    );
END;
$func$;

-- 6. Worker attendance tracking table
CREATE TABLE IF NOT EXISTS public.worker_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES public.society_workers(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  entry_method TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(worker_id, date)
);

ALTER TABLE public.worker_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view worker attendance" ON public.worker_attendance
  FOR SELECT USING (
    society_id = public.get_user_society_id(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "Security officers can insert attendance" ON public.worker_attendance
  FOR INSERT WITH CHECK (
    public.is_security_officer(auth.uid(), society_id)
    OR public.is_society_admin(auth.uid(), society_id)
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "Security officers can update attendance" ON public.worker_attendance
  FOR UPDATE USING (
    public.is_security_officer(auth.uid(), society_id)
    OR public.is_society_admin(auth.uid(), society_id)
    OR public.is_admin(auth.uid())
  );

CREATE INDEX idx_worker_attendance_worker_date ON public.worker_attendance(worker_id, date);
CREATE INDEX idx_worker_attendance_society_date ON public.worker_attendance(society_id, date);

-- 7. Delivery partners management table (if not exists)
CREATE TABLE IF NOT EXISTS public.delivery_partner_pool (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo_url TEXT,
  vehicle_type TEXT DEFAULT 'bike',
  vehicle_number TEXT,
  is_available BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  total_deliveries INTEGER DEFAULT 0,
  rating NUMERIC(3,2) DEFAULT 0,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.delivery_partner_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society admins can manage delivery partners" ON public.delivery_partner_pool
  FOR ALL USING (
    public.is_society_admin(auth.uid(), society_id)
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "Society members can view delivery partners" ON public.delivery_partner_pool
  FOR SELECT USING (
    society_id = public.get_user_society_id(auth.uid())
  );

CREATE INDEX idx_delivery_partner_pool_society ON public.delivery_partner_pool(society_id, is_active);

-- 8. Auto-log worker attendance on gate validation
CREATE OR REPLACE FUNCTION public.log_worker_gate_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  -- When a gate_entries record is created for a worker, log attendance
  IF NEW.entry_type = 'worker' AND NEW.notes LIKE 'Worker:%' THEN
    -- Extract worker info and try to log attendance
    INSERT INTO worker_attendance (worker_id, society_id, date, check_in_at, verified_by, entry_method)
    SELECT sw.id, NEW.society_id, CURRENT_DATE, NOW(), NEW.verified_by, 'gate_scan'
    FROM society_workers sw
    WHERE sw.society_id = NEW.society_id
      AND sw.worker_type = SUBSTRING(NEW.notes FROM 'Worker: (.+)')
    ON CONFLICT (worker_id, date) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$func$;
