-- Bug 1: Add missing index on delivery_locations.assignment_id
CREATE INDEX IF NOT EXISTS idx_delivery_locations_assignment_id ON public.delivery_locations(assignment_id);

-- Bug 9: Add index on recorded_at for retention cleanup
CREATE INDEX IF NOT EXISTS idx_delivery_locations_recorded_at ON public.delivery_locations(recorded_at);