-- Staging only. SSV-015/016: ops table RLS must require can_access_feature,
-- not UI gates. Membership stays AND-ed with the feature, never OR-ed as a
-- leftover PERMISSIVE bypass. Admin bypass stays server-side is_admin().

-- Parking
DROP POLICY IF EXISTS soc_read_parking ON public.parking_slots;
CREATE POLICY soc_read_parking
ON public.parking_slots
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'vehicle_parking')
  )
);

DROP POLICY IF EXISTS soc_insert_parking ON public.parking_slots;
CREATE POLICY soc_insert_parking
ON public.parking_slots
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'vehicle_parking')
  )
);

DROP POLICY IF EXISTS soc_read_violations ON public.parking_violations;
CREATE POLICY soc_read_violations
ON public.parking_violations
FOR SELECT
TO authenticated
USING (
  (
    society_id = public.get_user_society_id((SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  )
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'vehicle_parking')
  )
);

DROP POLICY IF EXISTS soc_insert_violations ON public.parking_violations;
CREATE POLICY soc_insert_violations
ON public.parking_violations
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'vehicle_parking')
  )
);

-- Workforce
DROP POLICY IF EXISTS soc_read_workers ON public.society_workers;
CREATE POLICY soc_read_workers
ON public.society_workers
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

DROP POLICY IF EXISTS soc_insert_workers ON public.society_workers;
CREATE POLICY soc_insert_workers
ON public.society_workers
FOR INSERT
TO authenticated
WITH CHECK (
  society_id = public.get_user_society_id((SELECT auth.uid()))
  AND (
    public.is_admin((SELECT auth.uid()))
    OR public.can_access_feature(society_id, 'workforce_management')
  )
);

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
  society_id = public.get_user_society_id((SELECT auth.uid()))
  OR public.is_admin((SELECT auth.uid()))
);

-- Manual entry: same feature pair as gate / visitor kiosk
DROP POLICY IF EXISTS soc_read_manual_entry ON public.manual_entry_requests;
CREATE POLICY soc_read_manual_entry
ON public.manual_entry_requests
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

DROP POLICY IF EXISTS soc_insert_manual_entry ON public.manual_entry_requests;
CREATE POLICY soc_insert_manual_entry
ON public.manual_entry_requests
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
  society_id = public.get_user_society_id((SELECT auth.uid()))
  OR public.is_admin((SELECT auth.uid()))
);

-- Gate read was membership-only. Match visitor SELECT: membership AND feature.
DROP POLICY IF EXISTS soc_read_gate ON public.gate_entries;
CREATE POLICY soc_read_gate
ON public.gate_entries
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

-- Fold CAF into the insert policy so the leftover membership-only PERMISSIVE
-- clause cannot stand alone. Restrictive CAF remains as defense in depth.
DROP POLICY IF EXISTS soc_insert_gate ON public.gate_entries;
CREATE POLICY soc_insert_gate
ON public.gate_entries
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
