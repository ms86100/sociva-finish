CREATE POLICY "Admins can read all feedback"
ON public.user_feedback FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));