-- Stage 2 (STAGING ONLY intent): align feature RPC contract + pilot ops catalog.
-- Safe for societies without a builder: keeps default-package enablement.
-- Pilot societies linked via builder get default + sociva_pilot_ops features.

DROP FUNCTION IF EXISTS public.get_effective_society_features(uuid);

CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
RETURNS TABLE(
  feature_key text,
  display_name text,
  is_enabled boolean,
  source text,
  society_configurable boolean,
  description text,
  icon_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _builder_id uuid;
  _builder_package_id uuid;
BEGIN
  SELECT bs.builder_id
  INTO _builder_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  IF _builder_id IS NOT NULL THEN
    SELECT bfp.package_id
    INTO _builder_package_id
    FROM public.builder_feature_packages bfp
    WHERE bfp.builder_id = _builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    ORDER BY bfp.assigned_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  RETURN QUERY
  WITH package_hits AS (
    SELECT
      pf.id AS feature_id,
      pf.feature_key,
      COALESCE(pf.display_name, pf.feature_name, pf.feature_key) AS display_name,
      pf.description,
      pf.icon_name,
      pf.is_core,
      pf.society_configurable,
      fpi.enabled AS package_enabled,
      CASE
        WHEN fp.is_default THEN 'package'
        ELSE 'package'
      END AS hit_source,
      fp.is_default
    FROM public.platform_features pf
    JOIN public.feature_package_items fpi ON fpi.feature_id = pf.id AND fpi.enabled = true
    JOIN public.feature_packages fp ON fp.id = fpi.package_id AND fp.is_active = true
    WHERE pf.is_active = true
      AND (
        fp.is_default = true
        OR (_builder_package_id IS NOT NULL AND fp.id = _builder_package_id)
        OR EXISTS (
          SELECT 1
          FROM public.builder_feature_packages bfp2
          WHERE bfp2.builder_id = _builder_id
            AND bfp2.package_id = fp.id
            AND (bfp2.expires_at IS NULL OR bfp2.expires_at > now())
        )
      )
  ),
  ranked AS (
    SELECT DISTINCT ON (ph.feature_key)
      ph.feature_id,
      ph.feature_key,
      ph.display_name,
      ph.description,
      ph.icon_name,
      ph.is_core,
      ph.society_configurable,
      ph.package_enabled,
      ph.hit_source
    FROM package_hits ph
    ORDER BY ph.feature_key, ph.is_default DESC
  )
  SELECT
    r.feature_key,
    r.display_name,
    CASE
      WHEN r.is_core THEN true
      WHEN sfo.id IS NOT NULL THEN sfo.is_enabled
      ELSE COALESCE(r.package_enabled, false)
    END AS is_enabled,
    CASE
      WHEN r.is_core THEN 'core'
      WHEN sfo.id IS NOT NULL THEN 'override'
      ELSE r.hit_source
    END AS source,
    CASE
      WHEN r.is_core THEN false
      WHEN COALESCE(r.society_configurable, true) = false THEN false
      ELSE true
    END AS society_configurable,
    r.description,
    r.icon_name
  FROM ranked r
  LEFT JOIN public.society_feature_overrides sfo
    ON sfo.feature_id = r.feature_id
   AND sfo.society_id = _society_id
  ORDER BY r.feature_key;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_society_features(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_society_features(uuid) TO authenticated, service_role;

-- Ensure pilot feature rows exist with complete metadata (idempotent upsert by key).
INSERT INTO public.platform_features (
  feature_key, feature_name, display_name, description, category,
  is_core, society_configurable, is_active, route, icon_name, tagline
)
VALUES
  ('marketplace', 'Marketplace', 'Marketplace', 'Buy and sell within the community', 'marketplace', false, true, true, '/', 'Store', 'Local commerce'),
  ('bulletin', 'Community Bulletin', 'Community Bulletin', 'Announcements, polls, and events', 'governance', false, true, true, '/community', 'MessageCircle', 'Society discussions'),
  ('smart_groups', 'Smart Groups', 'Smart Groups', 'Intent-aware community groups', 'community', false, true, true, '/community', 'Sparkles', 'Smarter community feed'),
  ('conversations', 'Conversations', 'Messages', 'Private and group conversations', 'community', false, true, true, '/messages', 'MessageSquare', 'Resident messaging'),
  ('disputes', 'Dispute System', 'Dispute System', 'Raise and track community concerns', 'governance', false, true, true, '/disputes', 'ShieldAlert', 'Resolve issues'),
  ('finances', 'Society Finances', 'Society Finances', 'Income and expense tracking', 'finance', false, true, true, '/society/finances', 'IndianRupee', 'Transparent finances'),
  ('maintenance', 'Maintenance Dues', 'Maintenance Dues', 'Monthly maintenance payment tracking', 'finance', false, true, true, '/maintenance', 'Landmark', 'Pay society dues'),
  ('payment_milestones', 'Payment Milestones', 'Payment Milestones', 'Construction-linked payment tracker', 'finance', false, true, true, '/payment-milestones', 'CreditCard', 'Track builder payments'),
  ('visitor_management', 'Visitor Management', 'Visitor Management', 'Gate entry with OTP verification', 'operations', false, true, true, '/visitors', 'Users', 'Visitor passes'),
  ('guard_kiosk', 'Guard Kiosk', 'Guard Kiosk', 'Gate security verification console', 'operations', false, true, true, '/guard-kiosk', 'Shield', 'Guard console'),
  ('gate_entry', 'Gate Entry', 'Gate Entry', 'Resident rotating QR gate pass', 'operations', false, true, true, '/gate-entry', 'QrCode', 'Digital gate pass'),
  ('resident_identity_verification', 'Resident ID Verification', 'Resident ID Verification', 'QR-based resident gate identity', 'operations', false, true, true, '/gate-entry', 'QrCode', 'Verify residents'),
  ('parcel_management', 'Parcel Management', 'Parcel Management', 'Delivery logging and collection', 'operations', false, true, true, '/parcels', 'Package', 'Track parcels'),
  ('vehicle_parking', 'Vehicle Parking', 'Vehicle Parking', 'Slot allocation and violations', 'operations', false, true, true, '/parking', 'Car', 'Manage parking'),
  ('society_notices', 'Society Notices', 'Society Notices', 'Official circulars and announcements', 'governance', false, true, true, '/society/notices', 'Megaphone', 'Official notices'),
  ('domestic_help', 'Domestic Help', 'Domestic Help', 'Domestic help registry (HelpHub path)', 'operations', false, true, true, '/help-hub', 'UserCheck', 'Find help'),
  ('helphub', 'HelpHub', 'HelpHub', 'Find and recommend local help', 'community', false, true, true, '/help-hub', 'HandHelping', 'Trusted help'),
  ('workforce_management', 'Workforce Management', 'Workforce Management', 'Worker registry and gate validation', 'operations', false, true, true, '/workforce', 'Wrench', 'Manage workers'),
  ('worker_marketplace', 'Worker Marketplace', 'Worker Marketplace', 'Hire skilled workers locally', 'operations', false, true, true, '/worker-hire', 'Briefcase', 'Hire workers'),
  ('construction_progress', 'Construction Progress', 'Construction Progress', 'Builder updates and milestones', 'construction', false, true, true, '/society/progress', 'Building2', 'Track construction'),
  ('snag_management', 'Snag Management', 'Snag Management', 'Report construction defects', 'construction', false, true, true, '/society/snags', 'Bug', 'Report snags'),
  ('inspection', 'Pre-Handover Inspection', 'Pre-Handover Inspection', 'Digital inspection checklists', 'construction', false, true, true, '/inspection', 'ClipboardCheck', 'Inspect flats'),
  ('help_requests', 'Help Requests', 'Help Requests', 'Neighbor-to-neighbor assistance', 'governance', false, true, true, '/community', 'HelpCircle', 'Ask for help'),
  ('delivery_management', 'Delivery Management', 'Delivery Management', 'Society delivery tracking', 'operations', false, true, true, '/society/deliveries', 'Truck', 'Track deliveries'),
  ('society_reports', 'Society Reports', 'Society Reports', 'Society health and report cards', 'governance', false, true, true, '/society/reports', 'BarChart3', 'Society reports'),
  ('cleaner_city', 'A Cleaner City', 'A Cleaner City', 'Commute sharing for residents', 'community', false, true, true, '/cleaner-city', 'Leaf', 'Shared commute')
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = COALESCE(EXCLUDED.feature_name, public.platform_features.feature_name),
  display_name = COALESCE(EXCLUDED.display_name, public.platform_features.display_name),
  description = COALESCE(EXCLUDED.description, public.platform_features.description),
  category = COALESCE(EXCLUDED.category, public.platform_features.category),
  society_configurable = COALESCE(EXCLUDED.society_configurable, public.platform_features.society_configurable),
  is_active = true,
  route = COALESCE(EXCLUDED.route, public.platform_features.route),
  icon_name = COALESCE(EXCLUDED.icon_name, public.platform_features.icon_name),
  tagline = COALESCE(EXCLUDED.tagline, public.platform_features.tagline),
  updated_at = now();

-- Dedicated pilot package (NOT default).
INSERT INTO public.feature_packages (name, package_name, description, is_active, is_default, price_tier)
SELECT
  'Sociva Pilot Ops',
  'sociva_pilot_ops',
  'Staging pilot package for MyGate-class society operations. Not assigned globally.',
  true,
  false,
  'pro'
WHERE NOT EXISTS (
  SELECT 1 FROM public.feature_packages WHERE package_name = 'sociva_pilot_ops' OR name = 'Sociva Pilot Ops'
);

-- Ensure default package still has core community/marketplace keys.
INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE fp.is_default = true
  AND fp.is_active = true
  AND pf.feature_key IN (
    'marketplace', 'bulletin', 'smart_groups', 'conversations', 'disputes',
    'finances', 'maintenance', 'visitor_management', 'domestic_help', 'helphub', 'cleaner_city'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_package_items x
    WHERE x.package_id = fp.id AND x.feature_id = pf.id
  );

-- Pilot ops package items (security + society OS modules).
INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE COALESCE(fp.package_name, fp.name) IN ('sociva_pilot_ops', 'Sociva Pilot Ops')
  AND pf.feature_key IN (
    'visitor_management', 'guard_kiosk', 'gate_entry', 'resident_identity_verification',
    'parcel_management', 'vehicle_parking', 'society_notices', 'workforce_management',
    'worker_marketplace', 'construction_progress', 'snag_management', 'inspection',
    'payment_milestones', 'help_requests', 'delivery_management', 'society_reports',
    'finances', 'maintenance', 'disputes', 'bulletin', 'smart_groups', 'helphub', 'domestic_help'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_package_items x
    WHERE x.package_id = fp.id AND x.feature_id = pf.id
  );
