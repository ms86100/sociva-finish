-- Production hotfix: close user_roles self-grant of admin/seller.
-- The remaining INSERT policy "Users can insert default buyer role" still
-- allows a logged-in user to insert role = buyer for themselves.

DROP POLICY "Users can insert default role" ON public.user_roles;
