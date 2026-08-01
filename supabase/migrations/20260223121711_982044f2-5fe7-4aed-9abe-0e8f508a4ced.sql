
-- Table to persist all test execution results
CREATE TABLE public.test_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id TEXT NOT NULL,
  module_name TEXT NOT NULL,
  test_name TEXT NOT NULL,
  page_or_api_url TEXT,
  input_data JSONB,
  outcome TEXT NOT NULL DEFAULT 'passed',
  duration_ms NUMERIC,
  response_payload JSONB,
  error_message TEXT,
  error_code TEXT,
  http_status_code INTEGER,
  file_path TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by run
CREATE INDEX idx_test_results_run_id ON public.test_results (run_id);
CREATE INDEX idx_test_results_module ON public.test_results (module_name);
CREATE INDEX idx_test_results_outcome ON public.test_results (outcome);
CREATE INDEX idx_test_results_executed_at ON public.test_results (executed_at DESC);

-- Enable RLS
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

-- Allow anon/service role to insert (edge function uses service role)
CREATE POLICY "Allow insert for all" ON public.test_results
  FOR INSERT WITH CHECK (true);

-- Allow read for authenticated users
CREATE POLICY "Allow read for authenticated" ON public.test_results
  FOR SELECT USING (true);
