
-- Fix 2: Consolidate duplicate/conflicting RLS policies on gate_entries
-- Remove the duplicate public-role policies that overlap with authenticated-role policies

DROP POLICY IF EXISTS "Security officers insert gate entries" ON public.gate_entries;
DROP POLICY IF EXISTS "Society admins view gate entries" ON public.gate_entries;
DROP POLICY IF EXISTS "Update gate entry confirmation" ON public.gate_entries;

-- Recreate UPDATE policy on authenticated role (clean)
CREATE POLICY "Authenticated update gate entry confirmation"
ON public.gate_entries
FOR UPDATE
TO authenticated
USING (
  (user_id = auth.uid())
  OR is_security_officer(auth.uid(), society_id)
  OR is_society_admin(auth.uid(), society_id)
);
