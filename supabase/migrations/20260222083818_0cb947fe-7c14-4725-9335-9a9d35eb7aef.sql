-- Allow security officers to INSERT workers (they can manage workers at the gate)
DROP POLICY IF EXISTS "Security officers can register workers" ON public.society_workers;
CREATE POLICY "Security officers can register workers"
ON public.society_workers
FOR INSERT
WITH CHECK (
  public.is_security_officer(auth.uid(), society_id)
);

-- Allow security officers to SELECT workers for validation
DROP POLICY IF EXISTS "Security officers can view workers" ON public.society_workers;
CREATE POLICY "Security officers can view workers"
ON public.society_workers
FOR SELECT
USING (
  public.is_security_officer(auth.uid(), society_id)
);

-- Allow security officers to insert flat assignments during registration
DROP POLICY IF EXISTS "Security officers can insert flat assignments" ON public.worker_flat_assignments;
CREATE POLICY "Security officers can insert flat assignments"
ON public.worker_flat_assignments
FOR INSERT
WITH CHECK (
  public.is_security_officer(auth.uid(), society_id)
);