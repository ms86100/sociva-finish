
-- =====================================================
-- MULTI-TENANT FEATURE MONETIZATION SYSTEM
-- =====================================================

-- TABLE 1: Platform Features (Master Catalog)
CREATE TABLE public.platform_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text UNIQUE NOT NULL,
  feature_name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'operations',
  is_core boolean NOT NULL DEFAULT false,
  is_experimental boolean NOT NULL DEFAULT false,
  society_configurable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_features_key ON public.platform_features (feature_key);

ALTER TABLE public.platform_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view features"
  ON public.platform_features FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage features"
  ON public.platform_features FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- TABLE 2: Feature Packages
CREATE TABLE public.feature_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name text NOT NULL,
  description text,
  price_tier text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view packages"
  ON public.feature_packages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage packages"
  ON public.feature_packages FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- TABLE 3: Feature Package Items
CREATE TABLE public.feature_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.feature_packages(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.platform_features(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(package_id, feature_id)
);

CREATE INDEX idx_feature_package_items_package ON public.feature_package_items (package_id);

ALTER TABLE public.feature_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view package items"
  ON public.feature_package_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage package items"
  ON public.feature_package_items FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- TABLE 4: Builder Feature Packages
CREATE TABLE public.builder_feature_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.builders(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.feature_packages(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  assigned_by uuid REFERENCES public.profiles(id),
  UNIQUE(builder_id, package_id)
);

CREATE INDEX idx_builder_feature_packages_builder ON public.builder_feature_packages (builder_id);

ALTER TABLE public.builder_feature_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage builder packages"
  ON public.builder_feature_packages FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Builder members can view own packages"
  ON public.builder_feature_packages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.builder_members bm
      WHERE bm.builder_id = builder_feature_packages.builder_id
        AND bm.user_id = auth.uid()
        AND bm.deactivated_at IS NULL
    )
  );

-- TABLE 5: Society Feature Overrides
CREATE TABLE public.society_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.platform_features(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL,
  overridden_by uuid REFERENCES public.profiles(id),
  overridden_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(society_id, feature_id)
);

CREATE INDEX idx_society_feature_overrides_society ON public.society_feature_overrides (society_id, feature_id);

ALTER TABLE public.society_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all overrides"
  ON public.society_feature_overrides FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Society admins can view own overrides"
  ON public.society_feature_overrides FOR SELECT TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Society admins can manage own overrides"
  ON public.society_feature_overrides FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Society admins can update own overrides"
  ON public.society_feature_overrides FOR UPDATE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

CREATE POLICY "Society admins can delete own overrides"
  ON public.society_feature_overrides FOR DELETE TO authenticated
  USING (public.is_society_admin(auth.uid(), society_id));

-- Same-society residents can view
CREATE POLICY "Society members can view overrides"
  ON public.society_feature_overrides FOR SELECT TO authenticated
  USING (
    public.get_user_society_id(auth.uid()) = society_id
  );

-- =====================================================
-- SEED: Insert 15 existing feature keys
-- =====================================================
INSERT INTO public.platform_features (feature_key, feature_name, description, category, is_core, society_configurable) VALUES
  ('marketplace', 'Marketplace', 'Buy & sell within the society', 'marketplace', false, true),
  ('bulletin', 'Community Bulletin', 'Announcements, polls, events', 'governance', false, true),
  ('disputes', 'Dispute System', 'Raise and track concerns', 'governance', false, true),
  ('finances', 'Society Finances', 'Income & expense tracking', 'finance', false, true),
  ('construction_progress', 'Construction Progress', 'Builder updates & milestones', 'construction', false, true),
  ('snag_management', 'Snag Management', 'Report construction defects', 'construction', false, true),
  ('help_requests', 'Help Requests', 'Community help board', 'governance', false, true),
  ('visitor_management', 'Visitor Management', 'Gate entry with OTP verification', 'operations', false, true),
  ('domestic_help', 'Domestic Help', 'Maid/cook/driver attendance tracking', 'operations', false, true),
  ('parcel_management', 'Parcel Management', 'Delivery logging & collection', 'operations', false, true),
  ('inspection', 'Pre-Handover Inspection', 'Digital inspection checklist', 'construction', false, true),
  ('payment_milestones', 'Payment Milestones', 'Construction-linked payment tracker', 'finance', false, true),
  ('maintenance', 'Maintenance Dues', 'Monthly maintenance payment tracking', 'finance', false, true),
  ('guard_kiosk', 'Guard Kiosk', 'Gate security OTP verification panel', 'operations', false, true),
  ('vehicle_parking', 'Vehicle Parking', 'Slot allocation & violation tracking', 'operations', false, true);

-- =====================================================
-- RPC: get_effective_society_features
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
RETURNS TABLE (
  feature_key text,
  is_enabled boolean,
  source text,
  society_configurable boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
BEGIN
  RETURN QUERY
  WITH builder_for_society AS (
    SELECT bs.builder_id
    FROM builder_societies bs
    WHERE bs.society_id = _society_id
    LIMIT 1
  ),
  package_features AS (
    SELECT
      pf.feature_key,
      fpi.enabled AS is_enabled,
      pf.id AS feature_id,
      pf.is_core,
      pf.society_configurable
    FROM builder_for_society bfs
    JOIN builder_feature_packages bfp ON bfp.builder_id = bfs.builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    JOIN feature_package_items fpi ON fpi.package_id = bfp.package_id
    JOIN platform_features pf ON pf.id = fpi.feature_id
  ),
  overrides AS (
    SELECT sfo.feature_id, sfo.is_enabled
    FROM society_feature_overrides sfo
    WHERE sfo.society_id = _society_id
  )
  -- Case 1: Features from builder packages (with overrides applied)
  SELECT
    pf_agg.feature_key,
    CASE
      WHEN pf_agg.is_core THEN true
      WHEN o.feature_id IS NOT NULL THEN o.is_enabled
      ELSE pf_agg.is_enabled
    END AS is_enabled,
    CASE
      WHEN pf_agg.is_core THEN 'core'
      WHEN o.feature_id IS NOT NULL THEN 'override'
      ELSE 'package'
    END AS source,
    pf_agg.society_configurable
  FROM (
    -- Deduplicate: if feature appears in multiple packages, enabled wins
    SELECT
      pff.feature_key,
      pff.feature_id,
      pff.is_core,
      pff.society_configurable,
      bool_or(pff.is_enabled) AS is_enabled
    FROM package_features pff
    GROUP BY pff.feature_key, pff.feature_id, pff.is_core, pff.society_configurable
  ) pf_agg
  LEFT JOIN overrides o ON o.feature_id = pf_agg.feature_id

  UNION ALL

  -- Case 2: Core features not in any package (always enabled)
  SELECT
    pf2.feature_key,
    true AS is_enabled,
    'core' AS source,
    pf2.society_configurable
  FROM platform_features pf2
  WHERE pf2.is_core = true
    AND NOT EXISTS (
      SELECT 1 FROM builder_for_society bfs2
      JOIN builder_feature_packages bfp2 ON bfp2.builder_id = bfs2.builder_id
      JOIN feature_package_items fpi2 ON fpi2.package_id = bfp2.package_id AND fpi2.feature_id = pf2.id
    )

  UNION ALL

  -- Case 3: No builder assigned → return ALL features as enabled (backward compat)
  SELECT
    pf3.feature_key,
    CASE
      WHEN pf3.is_core THEN true
      WHEN o3.feature_id IS NOT NULL THEN o3.is_enabled
      ELSE true
    END AS is_enabled,
    CASE
      WHEN o3.feature_id IS NOT NULL THEN 'override'
      ELSE 'default'
    END AS source,
    pf3.society_configurable
  FROM platform_features pf3
  LEFT JOIN society_feature_overrides o3 ON o3.feature_id = pf3.id AND o3.society_id = _society_id
  WHERE NOT EXISTS (SELECT 1 FROM builder_for_society);
END;
$$;

-- =====================================================
-- HELPER: is_feature_enabled_for_society (for RLS use)
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_feature_enabled_for_society(_society_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT ef.is_enabled FROM public.get_effective_society_features(_society_id) ef WHERE ef.feature_key = _feature_key LIMIT 1),
    true
  )
$$;

-- Updated_at triggers
CREATE TRIGGER update_platform_features_updated_at
  BEFORE UPDATE ON public.platform_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_feature_packages_updated_at
  BEFORE UPDATE ON public.feature_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
