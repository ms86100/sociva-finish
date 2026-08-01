
-- ============================================================
-- FEATURE 1: VISITOR MANAGEMENT SYSTEM
-- ============================================================

-- Pre-approved visitors / regular guests
CREATE TABLE public.visitor_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  resident_id uuid NOT NULL REFERENCES public.profiles(id),
  visitor_name text NOT NULL,
  visitor_phone text,
  visitor_type text NOT NULL DEFAULT 'guest', -- guest, delivery, cab, domestic_help, contractor
  purpose text,
  expected_date date,
  expected_time time,
  otp_code text,
  otp_expires_at timestamptz,
  is_preapproved boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_days text[], -- ['monday','wednesday'] etc
  status text NOT NULL DEFAULT 'expected', -- expected, checked_in, checked_out, cancelled, expired
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  vehicle_number text,
  photo_url text,
  flat_number text,
  guard_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visitor_entries ENABLE ROW LEVEL SECURITY;

-- Residents can see their own visitors + society admins see all in society
CREATE POLICY "Residents can view own visitors"
  ON public.visitor_entries FOR SELECT
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))));

CREATE POLICY "Residents can create visitor entries"
  ON public.visitor_entries FOR INSERT
  WITH CHECK (resident_id = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Residents can update own visitors"
  ON public.visitor_entries FOR UPDATE
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))));

CREATE POLICY "Residents can delete own visitors"
  ON public.visitor_entries FOR DELETE
  USING (resident_id = auth.uid());

CREATE INDEX idx_visitor_entries_society_status ON public.visitor_entries(society_id, status);
CREATE INDEX idx_visitor_entries_resident ON public.visitor_entries(resident_id, status);
CREATE INDEX idx_visitor_entries_otp ON public.visitor_entries(otp_code) WHERE otp_code IS NOT NULL;

-- ============================================================
-- FEATURE 2: PAYMENT MILESTONE TRACKER
-- ============================================================

CREATE TABLE public.payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  tower_id uuid REFERENCES public.project_towers(id),
  title text NOT NULL,
  description text,
  milestone_stage text NOT NULL DEFAULT 'booking', -- booking, foundation, slab, structure, finishing, possession
  amount_percentage numeric NOT NULL DEFAULT 0, -- % of total cost
  due_date date,
  status text NOT NULL DEFAULT 'upcoming', -- upcoming, due, overdue, paid
  linked_milestone_id uuid REFERENCES public.construction_milestones(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view payment milestones"
  ON public.payment_milestones FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can manage payment milestones"
  ON public.payment_milestones FOR INSERT
  WITH CHECK ((society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid()));

CREATE POLICY "Admins can update payment milestones"
  ON public.payment_milestones FOR UPDATE
  USING ((society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid()));

CREATE POLICY "Admins can delete payment milestones"
  ON public.payment_milestones FOR DELETE
  USING ((society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid()));

-- Individual resident payment tracking
CREATE TABLE public.resident_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES public.payment_milestones(id),
  resident_id uuid NOT NULL REFERENCES public.profiles(id),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  amount numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending', -- pending, paid, overdue, waived
  paid_at timestamptz,
  receipt_url text,
  transaction_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(milestone_id, resident_id)
);

ALTER TABLE public.resident_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own payments"
  ON public.resident_payments FOR SELECT
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))));

CREATE POLICY "Residents can update own payments"
  ON public.resident_payments FOR UPDATE
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))));

CREATE POLICY "Admins can insert payments"
  ON public.resident_payments FOR INSERT
  WITH CHECK ((society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR resident_id = auth.uid());

CREATE INDEX idx_payment_milestones_society ON public.payment_milestones(society_id, status);
CREATE INDEX idx_resident_payments_resident ON public.resident_payments(resident_id, payment_status);
CREATE INDEX idx_resident_payments_society ON public.resident_payments(society_id, payment_status);

-- ============================================================
-- FEATURE 3: PRE-HANDOVER INSPECTION CHECKLIST
-- ============================================================

CREATE TABLE public.inspection_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  tower_id uuid REFERENCES public.project_towers(id),
  flat_number text NOT NULL,
  resident_id uuid NOT NULL REFERENCES public.profiles(id),
  inspection_date date,
  status text NOT NULL DEFAULT 'draft', -- draft, in_progress, completed, submitted
  overall_score numeric DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  passed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  notes text,
  submitted_at timestamptz,
  builder_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inspection_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own checklists"
  ON public.inspection_checklists FOR SELECT
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))) OR is_admin(auth.uid()));

CREATE POLICY "Residents can create checklists"
  ON public.inspection_checklists FOR INSERT
  WITH CHECK (resident_id = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Residents can update own checklists"
  ON public.inspection_checklists FOR UPDATE
  USING (resident_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), society_id))));

CREATE TABLE public.inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.inspection_checklists(id) ON DELETE CASCADE,
  category text NOT NULL, -- electrical, plumbing, civil, carpentry, painting, flooring, doors_windows, kitchen, bathroom, balcony, common_areas
  item_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'not_checked', -- not_checked, pass, fail, na
  severity text DEFAULT 'minor', -- minor, major, critical
  photo_urls text[] DEFAULT '{}',
  notes text,
  display_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items visible with checklist access"
  ON public.inspection_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.inspection_checklists ic
    WHERE ic.id = inspection_items.checklist_id
    AND (ic.resident_id = auth.uid() OR (ic.society_id = get_user_society_id(auth.uid()) AND (is_admin(auth.uid()) OR is_society_admin(auth.uid(), ic.society_id))))
  ));

CREATE POLICY "Owners can manage items"
  ON public.inspection_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.inspection_checklists ic
    WHERE ic.id = inspection_items.checklist_id AND ic.resident_id = auth.uid()
  ));

CREATE POLICY "Owners can update items"
  ON public.inspection_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.inspection_checklists ic
    WHERE ic.id = inspection_items.checklist_id AND ic.resident_id = auth.uid()
  ));

CREATE POLICY "Owners can delete items"
  ON public.inspection_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.inspection_checklists ic
    WHERE ic.id = inspection_items.checklist_id AND ic.resident_id = auth.uid()
  ));

CREATE INDEX idx_inspection_checklists_society ON public.inspection_checklists(society_id, status);
CREATE INDEX idx_inspection_checklists_resident ON public.inspection_checklists(resident_id);
CREATE INDEX idx_inspection_items_checklist ON public.inspection_items(checklist_id, category);
