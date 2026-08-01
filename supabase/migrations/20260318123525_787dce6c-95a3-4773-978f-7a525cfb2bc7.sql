ALTER TABLE public.delivery_assignments ADD COLUMN IF NOT EXISTS proximity_status text DEFAULT 'en_route';

-- Enable realtime for proximity_status updates
COMMENT ON COLUMN public.delivery_assignments.proximity_status IS 'Auto-computed: en_route, nearby, arriving, at_doorstep';