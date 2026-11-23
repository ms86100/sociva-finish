-- ROLLBACK ONLY. Do not apply unless reverting the production user_roles hotfix.
-- Recreates the pre-hotfix INSERT policy that allowed any self-insert of any role.

CREATE POLICY "Users can insert default role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (user_id = (SELECT auth.uid() AS uid));
