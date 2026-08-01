
-- =============================================
-- 1. Domestic Help Entries table
-- =============================================
CREATE TABLE public.domestic_help_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  resident_id UUID NOT NULL REFERENCES public.profiles(id),
  help_name TEXT NOT NULL,
  help_phone TEXT,
  help_type TEXT NOT NULL DEFAULT 'maid', -- maid, cook, driver, nanny, gardener, other
  photo_url TEXT,
  flat_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domestic_help_society ON public.domestic_help_entries(society_id, is_active);

ALTER TABLE public.domestic_help_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view domestic help in their society"
ON public.domestic_help_entries FOR SELECT
USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Residents can add their own domestic help"
ON public.domestic_help_entries FOR INSERT
WITH CHECK (resident_id = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Residents can update their own domestic help"
ON public.domestic_help_entries FOR UPDATE
USING (resident_id = auth.uid() OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

CREATE POLICY "Residents can delete their own domestic help"
ON public.domestic_help_entries FOR DELETE
USING (resident_id = auth.uid() OR is_admin(auth.uid()));

-- =============================================
-- 2. Domestic Help Attendance table
-- =============================================
CREATE TABLE public.domestic_help_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  help_entry_id UUID NOT NULL REFERENCES public.domestic_help_entries(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_at TIMESTAMPTZ,
  marked_by UUID NOT NULL REFERENCES public.profiles(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domestic_attendance_date ON public.domestic_help_attendance(help_entry_id, date);

ALTER TABLE public.domestic_help_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society members can view attendance"
ON public.domestic_help_attendance FOR SELECT
USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Members can mark attendance"
ON public.domestic_help_attendance FOR INSERT
WITH CHECK (marked_by = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Members can update attendance"
ON public.domestic_help_attendance FOR UPDATE
USING (marked_by = auth.uid() OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

-- =============================================
-- 3. Parcel/Delivery Entries table
-- =============================================
CREATE TABLE public.parcel_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  resident_id UUID NOT NULL REFERENCES public.profiles(id),
  flat_number TEXT,
  courier_name TEXT, -- Amazon, Flipkart, Swiggy, etc.
  tracking_number TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'received', -- received, notified, collected, returned
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_at TIMESTAMPTZ,
  collected_by TEXT, -- name of person who collected
  photo_url TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parcel_entries_society_status ON public.parcel_entries(society_id, status);
CREATE INDEX idx_parcel_entries_resident ON public.parcel_entries(resident_id, status);

ALTER TABLE public.parcel_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view their own parcels"
ON public.parcel_entries FOR SELECT
USING (resident_id = auth.uid() OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

CREATE POLICY "Admins and guards can log parcels"
ON public.parcel_entries FOR INSERT
WITH CHECK (society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Admins can update parcels"
ON public.parcel_entries FOR UPDATE
USING (resident_id = auth.uid() OR is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));

CREATE POLICY "Admins can delete parcels"
ON public.parcel_entries FOR DELETE
USING (is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid()));
