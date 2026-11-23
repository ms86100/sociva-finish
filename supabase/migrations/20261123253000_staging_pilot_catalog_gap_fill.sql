-- STAGING ONLY (wwuanzbusxoyzixuprxs). Do not apply to production (kkzkuyhgdvyecmxtmkpy).
-- Catalog gap fill: add functional FeatureKeys that already have pages,
-- then attach them to sociva_pilot_ops only. Do not touch the default package.

INSERT INTO public.platform_features (
  feature_key, feature_name, display_name, description, category,
  is_core, society_configurable, is_active, route, icon_name, tagline
)
VALUES
  ('worker_attendance', 'Worker Attendance', 'Worker attendance', 'Mark maid, cook, and staff in/out at the gate', 'operations', false, true, true, '/workforce/attendance', 'ClipboardList', 'Staff in/out'),
  ('worker_salary', 'Worker Salary', 'Worker salary', 'Record domestic help and staff payouts', 'operations', false, true, true, '/workforce/salary', 'Wallet', 'Staff payouts'),
  ('worker_leave', 'Worker Leave', 'Worker leave', 'Track leave for society and household staff', 'operations', false, true, true, '/workforce/leave', 'CalendarOff', 'Staff leave'),
  ('security_audit', 'Security Audit', 'Security audit', 'Gate and visitor exception review for the society', 'operations', false, true, true, '/security-audit', 'ShieldCheck', 'Gate exceptions'),
  ('authorized_persons', 'Authorized Persons', 'Authorized persons', 'Family and staff who may approve visitors', 'operations', false, true, true, '/authorized-persons', 'UserCheck', 'Who can approve'),
  ('monthly_report_card', 'Monthly Report Card', 'Monthly report card', 'Society health snapshot for residents and RWA', 'governance', false, true, true, '/society/reports', 'BarChart3', 'Monthly health')
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

UPDATE public.platform_features SET
  display_name = CASE feature_key
    WHEN 'marketplace' THEN 'Society marketplace'
    WHEN 'bulletin' THEN 'Community board'
    WHEN 'conversations' THEN 'Messages'
    WHEN 'disputes' THEN 'Complaints'
    WHEN 'finances' THEN 'Society accounts'
    WHEN 'maintenance' THEN 'Maintenance dues'
    WHEN 'visitor_management' THEN 'Visitor passes'
    WHEN 'guard_kiosk' THEN 'Guard kiosk'
    WHEN 'gate_entry' THEN 'Gate QR'
    WHEN 'parcel_management' THEN 'Parcels at the gate'
    WHEN 'vehicle_parking' THEN 'Parking'
    WHEN 'society_notices' THEN 'Society notices'
    WHEN 'domestic_help' THEN 'Domestic help'
    WHEN 'workforce_management' THEN 'Society workforce'
    WHEN 'worker_marketplace' THEN 'Hire workers'
    WHEN 'construction_progress' THEN 'Construction updates'
    WHEN 'snag_management' THEN 'Snag list'
    WHEN 'help_requests' THEN 'Help requests'
    WHEN 'delivery_management' THEN 'Society deliveries'
    ELSE display_name
  END,
  updated_at = now()
WHERE feature_key IN (
  'marketplace', 'bulletin', 'conversations', 'disputes', 'finances', 'maintenance',
  'visitor_management', 'guard_kiosk', 'gate_entry', 'parcel_management', 'vehicle_parking',
  'society_notices', 'domestic_help', 'workforce_management', 'worker_marketplace',
  'construction_progress', 'snag_management', 'help_requests', 'delivery_management'
);

-- Pilot ops only. Default package is unchanged.
INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE COALESCE(fp.package_name, fp.name) IN ('sociva_pilot_ops', 'Sociva Pilot Ops')
  AND pf.feature_key IN (
    'marketplace', 'conversations', 'cleaner_city',
    'worker_attendance', 'worker_salary', 'worker_leave',
    'security_audit', 'authorized_persons', 'monthly_report_card'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_package_items x
    WHERE x.package_id = fp.id AND x.feature_id = pf.id
  );
