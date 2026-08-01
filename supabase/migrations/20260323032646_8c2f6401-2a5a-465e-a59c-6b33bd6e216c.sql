
-- Test scenarios table for E2E test runner
CREATE TABLE public.test_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  module text NOT NULL DEFAULT 'general',
  description text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 50,
  last_run_at timestamptz,
  last_result text DEFAULT 'pending',
  last_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.test_scenarios ENABLE ROW LEVEL SECURITY;

-- Only admins can manage test scenarios
CREATE POLICY "Admins can manage test_scenarios"
ON public.test_scenarios
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Enable realtime for live run updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.test_scenarios;
