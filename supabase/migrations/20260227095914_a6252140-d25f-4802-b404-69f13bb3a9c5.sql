
-- AI Review Log: append-only audit table for AI auto-review decisions
CREATE TABLE public.ai_review_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('seller', 'product')),
  target_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'flagged')),
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  reason text,
  rule_hits jsonb DEFAULT '[]'::jsonb,
  input_snapshot jsonb DEFAULT '{}'::jsonb,
  model_used text,
  society_id uuid REFERENCES public.societies(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_review_log ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read; no client-side writes
CREATE POLICY "Platform admins can view AI review logs"
  ON public.ai_review_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Indexes for common queries
CREATE INDEX idx_ai_review_log_target ON public.ai_review_log (target_type, target_id);
CREATE INDEX idx_ai_review_log_society_created ON public.ai_review_log (society_id, created_at DESC);
CREATE INDEX idx_ai_review_log_decision ON public.ai_review_log (decision, created_at DESC);
