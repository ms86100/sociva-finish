
CREATE POLICY "Authenticated users can read flows"
  ON public.category_status_flows
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read transitions"
  ON public.category_status_transitions
  FOR SELECT
  TO authenticated
  USING (true);
