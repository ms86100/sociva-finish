-- Add unique constraint to prevent duplicate AI reviews for same target
-- Uses (target_type, target_id) to ensure each item is only reviewed once
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_review_log_unique_target 
  ON public.ai_review_log (target_type, target_id);