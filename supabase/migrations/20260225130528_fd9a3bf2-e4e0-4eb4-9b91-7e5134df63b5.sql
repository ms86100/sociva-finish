
-- Update society_worker_categories policies to include builder members
DROP POLICY IF EXISTS "Society admins can manage categories" ON society_worker_categories;
CREATE POLICY "Society admins and builders can manage categories"
ON society_worker_categories FOR INSERT TO authenticated
WITH CHECK (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
);

DROP POLICY IF EXISTS "Society admins can update categories" ON society_worker_categories;
CREATE POLICY "Society admins and builders can update categories"
ON society_worker_categories FOR UPDATE TO authenticated
USING (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
);

DROP POLICY IF EXISTS "Society admins can delete categories" ON society_worker_categories;
CREATE POLICY "Society admins and builders can delete categories"
ON society_worker_categories FOR DELETE TO authenticated
USING (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
);

-- Also allow builders to view categories for their linked societies
DROP POLICY IF EXISTS "Society members can view categories" ON society_worker_categories;
CREATE POLICY "Society members and builders can view categories"
ON society_worker_categories FOR SELECT TO authenticated
USING (
  society_id = get_user_society_id(auth.uid())
  OR is_admin(auth.uid())
  OR is_builder_for_society(auth.uid(), society_id)
);

-- Update society_workers policies to include builder members
DROP POLICY IF EXISTS "Society admin manages workers" ON society_workers;
CREATE POLICY "Society admin and builders manage workers"
ON society_workers FOR ALL TO authenticated
USING (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
)
WITH CHECK (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
);

-- Update worker_flat_assignments policies to include builder members
DROP POLICY IF EXISTS "Admins and residents can insert flat assignments" ON worker_flat_assignments;
CREATE POLICY "Admins builders and residents can insert flat assignments"
ON worker_flat_assignments FOR INSERT TO authenticated
WITH CHECK (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
  OR resident_id = auth.uid()
);

DROP POLICY IF EXISTS "Admins and residents can update flat assignments" ON worker_flat_assignments;
CREATE POLICY "Admins builders and residents can update flat assignments"
ON worker_flat_assignments FOR UPDATE TO authenticated
USING (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
  OR resident_id = auth.uid()
);

DROP POLICY IF EXISTS "Admins and residents can delete flat assignments" ON worker_flat_assignments;
CREATE POLICY "Admins builders and residents can delete flat assignments"
ON worker_flat_assignments FOR DELETE TO authenticated
USING (
  is_society_admin(auth.uid(), society_id)
  OR is_builder_for_society(auth.uid(), society_id)
  OR resident_id = auth.uid()
);
