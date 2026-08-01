
-- Create a security definer function to check builder membership without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_builder_member(_user_id uuid, _builder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_members
    WHERE user_id = _user_id AND builder_id = _builder_id AND deactivated_at IS NULL
  )
$$;

-- Fix builders SELECT policy to use the security definer function
DROP POLICY IF EXISTS "Builders visible to their members and admins" ON public.builders;
CREATE POLICY "Builders visible to their members and admins"
  ON public.builders FOR SELECT
  USING (is_admin(auth.uid()) OR is_builder_member(auth.uid(), id));

-- Fix builder_members SELECT policy to use the security definer function
DROP POLICY IF EXISTS "Builder members visible to same builder" ON public.builder_members;
CREATE POLICY "Builder members visible to same builder"
  ON public.builder_members FOR SELECT
  USING (is_admin(auth.uid()) OR is_builder_member(auth.uid(), builder_id));
