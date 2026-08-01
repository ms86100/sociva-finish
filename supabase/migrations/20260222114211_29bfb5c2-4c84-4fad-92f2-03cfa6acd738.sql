
-- 1. Authorized persons per flat
CREATE TABLE IF NOT EXISTS public.authorized_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id),
  flat_number TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES public.profiles(id),
  person_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'family',
  phone TEXT, photo_url TEXT, is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.authorized_persons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_persons_policy" ON public.authorized_persons FOR ALL
  USING (resident_id = auth.uid() OR public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));
CREATE INDEX idx_auth_persons_sf ON public.authorized_persons(society_id, flat_number);

-- 2. Worker leave records
CREATE TABLE IF NOT EXISTS public.worker_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.society_workers(id),
  society_id UUID NOT NULL REFERENCES public.societies(id),
  leave_date DATE NOT NULL, leave_type TEXT NOT NULL DEFAULT 'planned',
  reason TEXT, marked_by UUID REFERENCES public.profiles(id), created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.worker_leave_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "worker_leave_pol" ON public.worker_leave_records FOR ALL
  USING (public.get_user_society_id(auth.uid()) = society_id OR public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));

-- 3. Worker salary records
CREATE TABLE IF NOT EXISTS public.worker_salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.society_workers(id),
  society_id UUID NOT NULL REFERENCES public.societies(id),
  resident_id UUID NOT NULL REFERENCES public.profiles(id),
  month TEXT NOT NULL, amount NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  paid_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.worker_salary_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "worker_salary_pol" ON public.worker_salary_records FOR ALL
  USING (resident_id = auth.uid() OR public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));
CREATE UNIQUE INDEX idx_ws_unique ON public.worker_salary_records(worker_id, resident_id, month);

-- 4. Visitor parking columns
ALTER TABLE public.visitor_entries ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
  ADD COLUMN IF NOT EXISTS parking_slot_id UUID REFERENCES public.parking_slots(id);

-- 5. Unified gate log (wrapped in subquery to allow ORDER BY)
CREATE OR REPLACE FUNCTION public.get_unified_gate_log(_society_id UUID, _date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(entry_type TEXT, person_name TEXT, flat_number TEXT, entry_time TIMESTAMPTZ, exit_time TIMESTAMPTZ, status TEXT, details TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '10s'
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT 'visitor'::TEXT, ve.visitor_name::TEXT, ve.flat_number::TEXT, ve.checked_in_at, ve.checked_out_at, ve.status::TEXT, ve.purpose::TEXT
    FROM visitor_entries ve WHERE ve.society_id = _society_id AND ve.created_at::date = _date
    UNION ALL
    SELECT 'resident'::TEXT, p.name::TEXT, p.flat_number::TEXT, ge.entry_time, NULL::TIMESTAMPTZ, ge.entry_type::TEXT, ge.notes::TEXT
    FROM gate_entries ge JOIN profiles p ON p.id = ge.user_id WHERE ge.society_id = _society_id AND ge.created_at::date = _date
    UNION ALL
    SELECT 'worker'::TEXT, sw.worker_type::TEXT, (SELECT string_agg(wfa.flat_number, ', ') FROM worker_flat_assignments wfa WHERE wfa.worker_id = sw.id AND wfa.is_active = true)::TEXT, wa.check_in_at, wa.check_out_at, 'entered'::TEXT, sw.worker_type::TEXT
    FROM worker_attendance wa JOIN society_workers sw ON sw.id = wa.worker_id WHERE wa.society_id = _society_id AND wa.date = _date
    UNION ALL
    SELECT 'delivery'::TEXT, COALESCE(da.rider_name, 'Delivery Agent')::TEXT, NULL::TEXT, da.pickup_at, da.delivered_at, da.status::TEXT, ('Order #' || LEFT(da.order_id::TEXT, 8))::TEXT
    FROM delivery_assignments da WHERE da.society_id = _society_id AND da.created_at::date = _date
  ) sub
  ORDER BY sub.entry_time DESC NULLS LAST;
END;
$$;

-- 6. Late fee
ALTER TABLE public.maintenance_dues ADD COLUMN IF NOT EXISTS late_fee NUMERIC DEFAULT 0;
CREATE OR REPLACE FUNCTION public.apply_maintenance_late_fees()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE maintenance_dues SET late_fee = GREATEST(ROUND(amount * 0.02 * EXTRACT(MONTH FROM AGE(CURRENT_DATE, (month || '-01')::date)), 2), 0)
  WHERE status = 'overdue';
END;
$$;

-- 7. Parking violation notification
CREATE OR REPLACE FUNCTION public.notify_parking_violation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _owner_id UUID;
BEGIN
  SELECT ps.resident_id INTO _owner_id FROM parking_slots ps WHERE ps.society_id = NEW.society_id AND ps.vehicle_number = NEW.vehicle_number AND ps.resident_id IS NOT NULL LIMIT 1;
  IF _owner_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path) VALUES (_owner_id, '🚗 Parking Violation', REPLACE(NEW.violation_type, '_', ' '), 'parking', '/vehicle-parking');
  END IF;
  INSERT INTO notification_queue (user_id, title, body, type, reference_path)
  SELECT sa.user_id, '🚗 Parking Violation', COALESCE(NEW.vehicle_number, 'Unknown'), 'parking', '/vehicle-parking'
  FROM society_admin_roles sa WHERE sa.society_id = NEW.society_id AND sa.is_active = true;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_parking_violation AFTER INSERT ON public.parking_violations FOR EACH ROW EXECUTE FUNCTION public.notify_parking_violation();

-- 8. Expense flag notification
CREATE OR REPLACE FUNCTION public.notify_expense_flagged()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t TEXT; _s UUID;
BEGIN
  SELECT title, society_id INTO _t, _s FROM society_expenses WHERE id = NEW.expense_id;
  INSERT INTO notification_queue (user_id, title, body, type, reference_path)
  SELECT sa.user_id, '⚠️ Expense Flagged', 'Flagged: ' || COALESCE(_t, 'Unknown'), 'finance', '/society/finances'
  FROM society_admin_roles sa WHERE sa.society_id = _s AND sa.is_active = true;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_expense_flagged AFTER INSERT ON public.expense_flags FOR EACH ROW EXECUTE FUNCTION public.notify_expense_flagged();

-- 9. Help request notification
CREATE OR REPLACE FUNCTION public.notify_help_request_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO notification_queue (user_id, title, body, type, reference_path)
  SELECT p.id, '🆘 Help Needed', LEFT(NEW.title, 100), 'help', '/bulletin'
  FROM profiles p WHERE p.society_id = NEW.society_id AND p.verification_status = 'approved' AND p.id != NEW.author_id LIMIT 50;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_help_request AFTER INSERT ON public.help_requests FOR EACH ROW EXECUTE FUNCTION public.notify_help_request_posted();

-- 10. Order → parcel
CREATE OR REPLACE FUNCTION public.auto_create_parcel_on_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _buyer_id UUID; _buyer_flat TEXT; _seller_name TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'delivered' THEN RETURN NEW; END IF;
  SELECT o.buyer_id INTO _buyer_id FROM orders o WHERE o.id = NEW.order_id;
  SELECT p.flat_number INTO _buyer_flat FROM profiles p WHERE p.id = _buyer_id;
  SELECT sp.business_name INTO _seller_name FROM orders o JOIN seller_profiles sp ON sp.id = o.seller_id WHERE o.id = NEW.order_id;
  INSERT INTO parcel_entries (society_id, resident_id, flat_number, courier_name, description, status)
  VALUES (NEW.society_id, _buyer_id, _buyer_flat, COALESCE(_seller_name, 'Sociva Order'), 'Order #' || LEFT(NEW.order_id::TEXT, 8), 'received');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_auto_parcel AFTER UPDATE ON public.delivery_assignments FOR EACH ROW EXECUTE FUNCTION public.auto_create_parcel_on_delivery();

-- 11. Auto check-out visitors
CREATE OR REPLACE FUNCTION public.auto_checkout_visitors()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE visitor_entries SET status = 'checked_out', checked_out_at = now() WHERE status = 'checked_in' AND checked_in_at < CURRENT_DATE;
END;
$$;

-- 12. Builder inspection acknowledgement
ALTER TABLE public.inspection_checklists
  ADD COLUMN IF NOT EXISTS builder_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS builder_acknowledged_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS builder_notes TEXT;
ALTER TABLE public.inspection_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
