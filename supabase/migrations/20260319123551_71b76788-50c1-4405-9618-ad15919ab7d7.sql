-- Add explicit starts_live_activity flag to category_status_flows
ALTER TABLE public.category_status_flows
ADD COLUMN starts_live_activity boolean NOT NULL DEFAULT false;

-- Create index for efficient lookup
CREATE INDEX idx_csf_starts_live_activity ON public.category_status_flows (starts_live_activity) WHERE starts_live_activity = true;