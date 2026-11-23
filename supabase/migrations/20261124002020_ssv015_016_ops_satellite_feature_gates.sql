-- Staging only. SSV-015/016 follow-up: satellite ops tables still had
-- membership-only PERMISSIVE policies (no can_access_feature). Fold CAF
-- into the same policy. Do not apply on production.

-- Fold CAF into UPDATE WITH CHECK left as membership-only in 20261124002000.
DROP POLICY IF EXISTS soc_update_workers ON public.society_workers;
CREATE POLICY soc_update_workers
ON public.society_workers
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'workforce_management')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_update_manual_entry ON public.manual_entry_requests;
CREATE POLICY soc_update_manual_entry
ON public.manual_entry_requests
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
);

-- Worker categories
DROP POLICY IF EXISTS soc_read_worker_cats ON public.society_worker_categories;
CREATE POLICY soc_read_worker_cats
ON public.society_worker_categories
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_insert_worker_cats ON public.society_worker_categories;
CREATE POLICY soc_insert_worker_cats
ON public.society_worker_categories
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

-- Attendance / logs
DROP POLICY IF EXISTS "Society members can view worker attendance" ON public.worker_attendance;
CREATE POLICY soc_read_worker_attendance
ON public.worker_attendance
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_attendance')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS "Society members can view worker logs" ON public.worker_entry_logs;
CREATE POLICY soc_read_worker_entry_logs
ON public.worker_entry_logs
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_attendance')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

-- Leave
DROP POLICY IF EXISTS soc_read_leave ON public.worker_leave_records;
CREATE POLICY soc_read_leave
ON public.worker_leave_records
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_leave')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_insert_leave ON public.worker_leave_records;
CREATE POLICY soc_insert_leave
ON public.worker_leave_records
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_leave')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_update_leave ON public.worker_leave_records;
CREATE POLICY soc_update_leave
ON public.worker_leave_records
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_leave')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_leave')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

-- Salary
DROP POLICY IF EXISTS soc_read_salary ON public.worker_salary_records;
CREATE POLICY soc_read_salary
ON public.worker_salary_records
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_salary')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_insert_salary ON public.worker_salary_records;
CREATE POLICY soc_insert_salary
ON public.worker_salary_records
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_salary')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_update_salary ON public.worker_salary_records;
CREATE POLICY soc_update_salary
ON public.worker_salary_records
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_salary')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_salary')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

-- Job requests: keep own-row access, AND marketplace/workforce CAF
DROP POLICY IF EXISTS soc_read_job_reqs ON public.worker_job_requests;
CREATE POLICY soc_read_job_reqs
ON public.worker_job_requests
FOR SELECT
TO authenticated
USING (
  (
    resident_id = (SELECT auth.uid())
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_marketplace')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS own_insert_job_reqs ON public.worker_job_requests;
CREATE POLICY own_insert_job_reqs
ON public.worker_job_requests
FOR INSERT
TO authenticated
WITH CHECK (
  resident_id = (SELECT auth.uid())
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_marketplace')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

DROP POLICY IF EXISTS soc_update_job_reqs ON public.worker_job_requests;
CREATE POLICY soc_update_job_reqs
ON public.worker_job_requests
FOR UPDATE
TO authenticated
USING (
  (
    resident_id = (SELECT auth.uid())
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_marketplace')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
)
WITH CHECK (
  (
    resident_id = (SELECT auth.uid())
    OR society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'worker_marketplace')
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

-- Assignments / ratings inherit society from the worker row
DROP POLICY IF EXISTS "Residents can view assignments" ON public.worker_flat_assignments;
CREATE POLICY soc_read_worker_flat_assignments
ON public.worker_flat_assignments
FOR SELECT
TO authenticated
USING (
  (
    resident_id = (SELECT auth.uid())
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.society_workers sw
      WHERE sw.id = worker_id
        AND (
          public.can_access_feature(sw.society_id, 'workforce_management')
          OR public.can_access_feature(sw.society_id, 'worker_marketplace')
        )
    )
  )
);

DROP POLICY IF EXISTS own_read_worker_ratings ON public.worker_ratings;
CREATE POLICY own_read_worker_ratings
ON public.worker_ratings
FOR SELECT
TO authenticated
USING (
  resident_id = (SELECT auth.uid())
  AND (
    public.is_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.society_workers sw
      WHERE sw.id = worker_id
        AND (
          public.can_access_feature(sw.society_id, 'workforce_management')
          OR public.can_access_feature(sw.society_id, 'worker_marketplace')
        )
    )
  )
);

DROP POLICY IF EXISTS own_insert_worker_ratings ON public.worker_ratings;
CREATE POLICY own_insert_worker_ratings
ON public.worker_ratings
FOR INSERT
TO authenticated
WITH CHECK (
  resident_id = (SELECT auth.uid())
  AND (
    public.is_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.society_workers sw
      WHERE sw.id = worker_id
        AND (
          public.can_access_feature(sw.society_id, 'workforce_management')
          OR public.can_access_feature(sw.society_id, 'worker_marketplace')
        )
    )
  )
);

-- Domestic help
DROP POLICY IF EXISTS soc_read_dh_attend ON public.domestic_help_attendance;
CREATE POLICY soc_read_dh_attend
ON public.domestic_help_attendance
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

DROP POLICY IF EXISTS soc_insert_dh_attend ON public.domestic_help_attendance;
CREATE POLICY soc_insert_dh_attend
ON public.domestic_help_attendance
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

DROP POLICY IF EXISTS soc_update_dh_attend ON public.domestic_help_attendance;
CREATE POLICY soc_update_dh_attend
ON public.domestic_help_attendance
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

DROP POLICY IF EXISTS soc_read_dh_entries ON public.domestic_help_entries;
CREATE POLICY soc_read_dh_entries
ON public.domestic_help_entries
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

DROP POLICY IF EXISTS soc_insert_dh_entries ON public.domestic_help_entries;
CREATE POLICY soc_insert_dh_entries
ON public.domestic_help_entries
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

DROP POLICY IF EXISTS soc_update_dh_entries ON public.domestic_help_entries;
CREATE POLICY soc_update_dh_entries
ON public.domestic_help_entries
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'domestic_help')
  )
);

-- Guard roster: same feature pair as gate / visitor
DROP POLICY IF EXISTS soc_read_security ON public.security_staff;
CREATE POLICY soc_read_security
ON public.security_staff
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
);

DROP POLICY IF EXISTS soc_insert_security ON public.security_staff;
CREATE POLICY soc_insert_security
ON public.security_staff
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
);

DROP POLICY IF EXISTS soc_update_security ON public.security_staff;
CREATE POLICY soc_update_security
ON public.security_staff
FOR UPDATE
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
)
WITH CHECK (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  )
);
