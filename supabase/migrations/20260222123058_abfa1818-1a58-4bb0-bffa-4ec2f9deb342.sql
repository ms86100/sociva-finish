-- Phase 2.1: Add display metadata to platform_features
ALTER TABLE public.platform_features 
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS icon_name TEXT;

-- Seed display metadata for existing features
UPDATE public.platform_features SET display_name = 'Marketplace', description = 'Buy & sell within the society', icon_name = 'Store' WHERE feature_key = 'marketplace';
UPDATE public.platform_features SET display_name = 'Community Bulletin', description = 'Announcements, polls, events', icon_name = 'MessageCircle' WHERE feature_key = 'bulletin';
UPDATE public.platform_features SET display_name = 'Dispute System', description = 'Raise and track concerns', icon_name = 'ShieldAlert' WHERE feature_key = 'disputes';
UPDATE public.platform_features SET display_name = 'Society Finances', description = 'Income & expense tracking', icon_name = 'IndianRupee' WHERE feature_key = 'finances';
UPDATE public.platform_features SET display_name = 'Construction Progress', description = 'Builder updates & milestones', icon_name = 'Building2' WHERE feature_key = 'construction_progress';
UPDATE public.platform_features SET display_name = 'Snag Management', description = 'Report construction defects', icon_name = 'Bug' WHERE feature_key = 'snag_management';
UPDATE public.platform_features SET display_name = 'Help Requests', description = 'Community help board', icon_name = 'MessageCircle' WHERE feature_key = 'help_requests';
UPDATE public.platform_features SET display_name = 'Visitor Management', description = 'Gate entry with OTP verification', icon_name = 'Users' WHERE feature_key = 'visitor_management';
UPDATE public.platform_features SET display_name = 'Domestic Help', description = 'Maid/cook/driver attendance tracking', icon_name = 'UserCheck' WHERE feature_key = 'domestic_help';
UPDATE public.platform_features SET display_name = 'Parcel Management', description = 'Delivery logging & collection', icon_name = 'Package' WHERE feature_key = 'parcel_management';
UPDATE public.platform_features SET display_name = 'Pre-Handover Inspection', description = 'Digital inspection checklist', icon_name = 'ClipboardCheck' WHERE feature_key = 'inspection';
UPDATE public.platform_features SET display_name = 'Payment Milestones', description = 'Construction-linked payment tracker', icon_name = 'CreditCard' WHERE feature_key = 'payment_milestones';
UPDATE public.platform_features SET display_name = 'Maintenance Dues', description = 'Monthly maintenance payment tracking', icon_name = 'Landmark' WHERE feature_key = 'maintenance';
UPDATE public.platform_features SET display_name = 'Guard Kiosk', description = 'Gate security OTP verification panel', icon_name = 'Shield' WHERE feature_key = 'guard_kiosk';
UPDATE public.platform_features SET display_name = 'Vehicle Parking', description = 'Slot allocation & violation tracking', icon_name = 'Car' WHERE feature_key = 'vehicle_parking';
UPDATE public.platform_features SET display_name = 'Resident ID Verification', description = 'QR-based gate entry with anti-impersonation', icon_name = 'QrCode' WHERE feature_key = 'resident_identity_verification';
UPDATE public.platform_features SET display_name = 'Worker Marketplace', description = 'AI-assisted daily help hiring system', icon_name = 'Briefcase' WHERE feature_key = 'worker_marketplace';
UPDATE public.platform_features SET display_name = 'Workforce Management', description = 'Worker registry with shift validation & gate integration', icon_name = 'Wrench' WHERE feature_key = 'workforce_management';

-- Phase 2.2: Create visitor_types config table
CREATE TABLE IF NOT EXISTS public.visitor_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID REFERENCES public.societies(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(society_id, type_key)
);

ALTER TABLE public.visitor_types ENABLE ROW LEVEL SECURITY;

-- Anyone in the society can read visitor types
CREATE POLICY "Society members can read visitor types"
  ON public.visitor_types FOR SELECT
  TO authenticated
  USING (
    society_id IS NULL 
    OR society_id = public.get_user_society_id(auth.uid())
    OR public.is_admin(auth.uid())
  );

-- Only society admins can manage visitor types
CREATE POLICY "Society admins can manage visitor types"
  ON public.visitor_types FOR ALL
  TO authenticated
  USING (public.can_manage_society(auth.uid(), society_id))
  WITH CHECK (public.can_manage_society(auth.uid(), society_id));

-- Insert default (global) visitor types (society_id = NULL means defaults)
INSERT INTO public.visitor_types (society_id, type_key, label, icon, display_order) VALUES
  (NULL, 'guest', 'Guest', 'Users', 1),
  (NULL, 'delivery', 'Delivery', 'Truck', 2),
  (NULL, 'cab', 'Cab/Ride', 'Car', 3),
  (NULL, 'domestic_help', 'Domestic Help', 'UserCheck', 4),
  (NULL, 'contractor', 'Contractor', 'Wrench', 5)
ON CONFLICT DO NOTHING;

-- Create RPC to get visitor types (society overrides + global defaults)
CREATE OR REPLACE FUNCTION public.get_visitor_types_for_society(_society_id UUID)
RETURNS TABLE(type_key TEXT, label TEXT, icon TEXT, display_order INT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- If society has custom types, use those; otherwise use global defaults
  SELECT vt.type_key, vt.label, vt.icon, vt.display_order
  FROM public.visitor_types vt
  WHERE vt.is_active = true
    AND (
      vt.society_id = _society_id
      OR (vt.society_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.visitor_types vt2 
        WHERE vt2.society_id = _society_id AND vt2.type_key = vt.type_key
      ))
    )
  ORDER BY vt.display_order ASC;
$$;

-- Update get_effective_society_features to also return display metadata
CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id UUID)
RETURNS TABLE(feature_key TEXT, is_enabled BOOLEAN, source TEXT, society_configurable BOOLEAN, display_name TEXT, description TEXT, icon_name TEXT)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _builder_id UUID;
  _package_id UUID;
BEGIN
  -- Find builder for this society
  SELECT bs.builder_id INTO _builder_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  -- Find active package for builder
  IF _builder_id IS NOT NULL THEN
    SELECT bfp.package_id INTO _package_id
    FROM public.builder_feature_packages bfp
    WHERE bfp.builder_id = _builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    ORDER BY bfp.assigned_at DESC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    pf.feature_key,
    CASE
      -- Core features always enabled
      WHEN pf.is_core THEN true
      -- Check society override first
      WHEN sfo.id IS NOT NULL THEN sfo.is_enabled
      -- Check package inclusion
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL THEN fpi.is_enabled
      -- Default
      ELSE pf.is_enabled_by_default
    END AS is_enabled,
    CASE
      WHEN pf.is_core THEN 'core'
      WHEN sfo.id IS NOT NULL THEN 'override'
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL THEN 'package'
      ELSE 'default'
    END AS source,
    CASE
      WHEN pf.is_core THEN false
      WHEN _package_id IS NOT NULL AND fpi.id IS NOT NULL AND NOT fpi.is_enabled THEN false
      ELSE true
    END AS society_configurable,
    pf.display_name,
    pf.description,
    pf.icon_name
  FROM public.platform_features pf
  LEFT JOIN public.society_feature_overrides sfo
    ON sfo.feature_id = pf.id AND sfo.society_id = _society_id
  LEFT JOIN public.feature_package_items fpi
    ON fpi.package_id = _package_id AND fpi.feature_id = pf.id
  WHERE pf.is_active = true
  ORDER BY pf.feature_key;
END;
$$;