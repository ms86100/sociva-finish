
-- Gap 8: Drop the overly permissive buyer UPDATE policy (replaced by RPC)
DROP POLICY IF EXISTS "Buyers can update delivery coords on own orders" ON public.orders;
