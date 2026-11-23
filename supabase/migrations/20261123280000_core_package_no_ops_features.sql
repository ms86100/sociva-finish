-- Core is marketplace + community. Gate/parking/parcel ops stay on Pilot Ops.
-- Societies without a Pilot builder (Palm Breeze Core-only) must FeatureGate visitors.

DELETE FROM public.feature_package_items fpi
USING public.feature_packages fp, public.platform_features pf
WHERE fpi.package_id = fp.id
  AND fpi.feature_id = pf.id
  AND fp.is_default = true
  AND pf.feature_key IN (
    'visitor_management',
    'guard_kiosk',
    'gate_entry',
    'resident_identity_verification',
    'parcel_management',
    'vehicle_parking',
    'workforce_management',
    'worker_marketplace',
    'construction_progress',
    'snag_management',
    'inspection',
    'payment_milestones',
    'delivery_management'
  );
