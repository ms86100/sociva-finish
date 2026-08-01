-- Allow reading basic society info (name, address) for all societies, not just active ones
-- This is needed so buyer can see seller's society info on the seller detail page
DROP POLICY IF EXISTS "Anyone can view active societies" ON public.societies;

CREATE POLICY "Anyone can view societies"
  ON public.societies
  FOR SELECT
  USING (true);