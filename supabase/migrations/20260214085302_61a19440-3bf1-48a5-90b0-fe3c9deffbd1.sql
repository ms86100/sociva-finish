
-- Vehicle Parking Management tables
CREATE TABLE public.parking_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  slot_number TEXT NOT NULL,
  slot_type TEXT NOT NULL DEFAULT 'car', -- car, bike, visitor
  tower_id UUID REFERENCES public.project_towers(id),
  assigned_to UUID REFERENCES public.profiles(id),
  vehicle_number TEXT,
  vehicle_type TEXT,
  is_occupied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(society_id, slot_number)
);

CREATE TABLE public.parking_violations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  slot_id UUID REFERENCES public.parking_slots(id),
  reported_by UUID NOT NULL REFERENCES public.profiles(id),
  vehicle_number TEXT,
  violation_type TEXT NOT NULL DEFAULT 'unauthorized', -- unauthorized, double_parking, blocking, other
  description TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open, resolved, dismissed
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for parking_slots
ALTER TABLE public.parking_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view parking slots"
  ON public.parking_slots FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can manage parking slots"
  ON public.parking_slots FOR ALL
  USING (is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

-- RLS for parking_violations
ALTER TABLE public.parking_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view violations"
  ON public.parking_violations FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Members can report violations"
  ON public.parking_violations FOR INSERT
  WITH CHECK (reported_by = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Admins can update violations"
  ON public.parking_violations FOR UPDATE
  USING (is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));
