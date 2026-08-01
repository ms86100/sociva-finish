
-- Phase 3: GPS Location Tracking + delivery_assignments columns

-- 1. Add ETA/location columns to delivery_assignments
ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS eta_minutes int,
  ADD COLUMN IF NOT EXISTS distance_meters int,
  ADD COLUMN IF NOT EXISTS last_location_lat double precision,
  ADD COLUMN IF NOT EXISTS last_location_lng double precision,
  ADD COLUMN IF NOT EXISTS last_location_at timestamptz;

-- 2. Create delivery_locations table
CREATE TABLE IF NOT EXISTS public.delivery_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  speed_kmh double precision,
  heading double precision,
  accuracy_meters double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_locations_assignment ON public.delivery_locations(assignment_id, recorded_at DESC);

ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users can read locations for their orders
CREATE POLICY "delivery_locations_select_authenticated"
  ON public.delivery_locations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_assignments da
      JOIN public.orders o ON o.id = da.order_id
      WHERE da.id = delivery_locations.assignment_id
        AND (o.buyer_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.seller_profiles sp WHERE sp.id = o.seller_id AND sp.user_id = auth.uid()
        ))
    )
  );

-- RLS: Insert only via edge function (service role)
-- No insert policy for anon/authenticated - edge function uses service role

-- 3. Enable Realtime for delivery_locations
ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_locations;
