
-- Allow admin users to manage category_status_flows and category_status_transitions
-- Using has_role function for admin check

CREATE POLICY "admins_insert_flows" ON public.category_status_flows
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_delete_flows" ON public.category_status_flows
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_update_flows" ON public.category_status_flows
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Same for transitions table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_status_transitions' AND policyname = 'admins_insert_transitions') THEN
    EXECUTE 'CREATE POLICY "admins_insert_transitions" ON public.category_status_transitions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_status_transitions' AND policyname = 'admins_delete_transitions') THEN
    EXECUTE 'CREATE POLICY "admins_delete_transitions" ON public.category_status_transitions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'category_status_transitions' AND policyname = 'admins_update_transitions') THEN
    EXECUTE 'CREATE POLICY "admins_update_transitions" ON public.category_status_transitions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))';
  END IF;
END $$;
