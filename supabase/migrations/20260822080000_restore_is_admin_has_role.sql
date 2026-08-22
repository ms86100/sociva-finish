-- Restore is_admin to the original role check. Production had been reduced to
-- "_user_id IS NOT NULL", which treated every authenticated user as admin and
-- leaked seller-credit summaries to buyers.

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;
