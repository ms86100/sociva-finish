-- SSV-002 (staging): residents may INSERT only role = buyer for themselves.
-- The merged_user_roles_insert WITH CHECK was (buyer) OR (user_id = auth.uid()),
-- which allowed self-insert of admin. Platform admins keep ALL via is_admin().
-- Seller role stays admin-granted (approveSeller / user_roles ALL policy).

DROP POLICY IF EXISTS "merged_user_roles_insert" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert default buyer role" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_insert_self_buyer" ON public.user_roles;

CREATE POLICY "user_roles_insert_self_buyer"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'buyer'::user_role
  );

COMMENT ON POLICY "user_roles_insert_self_buyer" ON public.user_roles IS
  'Self-insert is buyer only. Admin/seller grants use is_admin ALL policy or service role.';
