
-- =====================================================
-- RESIDENT IDENTITY VERIFICATION & GATE SECURITY SYSTEM
-- =====================================================

-- Add security_officer to user_role enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'security_officer';

-- Table: security_staff (assigned to exactly one society)
CREATE TABLE public.security_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE(user_id, society_id)
);

CREATE INDEX idx_security_staff_society ON public.security_staff (society_id) WHERE is_active = true;
CREATE INDEX idx_security_staff_user ON public.security_staff (user_id) WHERE is_active = true;

ALTER TABLE public.security_staff ENABLE ROW LEVEL SECURITY;

-- Security helper function
CREATE OR REPLACE FUNCTION public.is_security_officer(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.security_staff
    WHERE user_id = _user_id
      AND society_id = _society_id
      AND is_active = true
      AND deactivated_at IS NULL
  ) OR public.is_society_admin(_user_id, _society_id)
$$;

-- RLS for security_staff
CREATE POLICY "Admins and society admins can manage security staff"
  ON public.security_staff FOR ALL TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()))
  WITH CHECK (public.is_society_admin(auth.uid(), society_id) OR public.is_admin(auth.uid()));

CREATE POLICY "Security officers can view own record"
  ON public.security_staff FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Table: gate_entries (audit log of all gate entries)
CREATE TABLE public.gate_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  entry_time timestamptz NOT NULL DEFAULT now(),
  entry_type text NOT NULL DEFAULT 'qr_verified',
  verified_by uuid REFERENCES public.profiles(id),
  confirmation_status text DEFAULT 'not_required',
  flat_number text,
  resident_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gate_entries_society_time ON public.gate_entries (society_id, entry_time DESC);
CREATE INDEX idx_gate_entries_user ON public.gate_entries (user_id, entry_time DESC);

ALTER TABLE public.gate_entries ENABLE ROW LEVEL SECURITY;

-- Security officers and admins can insert gate entries
CREATE POLICY "Security officers can insert gate entries"
  ON public.gate_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_security_officer(auth.uid(), society_id));

-- Security officers can view entries for their society
CREATE POLICY "Security officers can view society entries"
  ON public.gate_entries FOR SELECT TO authenticated
  USING (public.is_security_officer(auth.uid(), society_id));

-- Residents can view their own entries
CREATE POLICY "Residents can view own entries"
  ON public.gate_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Society admins can view all entries
CREATE POLICY "Society admins can view all entries"
  ON public.gate_entries FOR SELECT TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

-- Table: manual_entry_requests (for "forgot phone" scenario)
CREATE TABLE public.manual_entry_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_number text NOT NULL,
  claimed_name text NOT NULL,
  requested_by uuid REFERENCES public.profiles(id),
  resident_id uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending',
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX idx_manual_entry_pending ON public.manual_entry_requests (society_id, status) WHERE status = 'pending';

ALTER TABLE public.manual_entry_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Security officers can create manual requests"
  ON public.manual_entry_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_security_officer(auth.uid(), society_id));

CREATE POLICY "Security officers can view requests"
  ON public.manual_entry_requests FOR SELECT TO authenticated
  USING (public.is_security_officer(auth.uid(), society_id));

CREATE POLICY "Residents can view and respond to requests for their flat"
  ON public.manual_entry_requests FOR SELECT TO authenticated
  USING (resident_id = auth.uid());

CREATE POLICY "Residents can update their requests"
  ON public.manual_entry_requests FOR UPDATE TO authenticated
  USING (resident_id = auth.uid());

-- Add resident_identity_verification to platform_features
INSERT INTO public.platform_features (feature_key, feature_name, description, category, is_core, society_configurable)
VALUES ('resident_identity_verification', 'Resident Identity Verification', 'QR-based gate entry with anti-impersonation', 'operations', false, true)
ON CONFLICT (feature_key) DO NOTHING;

-- Update guard_kiosk access to include security officers
-- (The existing GuardKioskPage checks isSocietyAdmin, we'll update access in code)
