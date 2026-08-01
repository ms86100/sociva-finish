-- Add missing index for manual entry requests by resident
CREATE INDEX IF NOT EXISTS idx_manual_entry_resident ON public.manual_entry_requests (resident_id) WHERE status = 'pending';

-- Enable realtime for manual_entry_requests so residents get live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.manual_entry_requests;
