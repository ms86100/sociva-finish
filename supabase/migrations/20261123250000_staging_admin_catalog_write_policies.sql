-- Staging only: restore intended admin write policies for catalog + package assignment.
-- Production schema-export already documents these. Staging lost them, so Feature
-- Management could not create packages or assign them to builders/societies.

DROP POLICY IF EXISTS "Admins can manage builder packages" ON public.builder_feature_packages;
CREATE POLICY "Admins can manage builder packages"
  ON public.builder_feature_packages
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage packages" ON public.feature_packages;
CREATE POLICY "Admins can manage packages"
  ON public.feature_packages
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage package items" ON public.feature_package_items;
CREATE POLICY "Admins can manage package items"
  ON public.feature_package_items
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage features" ON public.platform_features;
CREATE POLICY "Admins can manage features"
  ON public.platform_features
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
