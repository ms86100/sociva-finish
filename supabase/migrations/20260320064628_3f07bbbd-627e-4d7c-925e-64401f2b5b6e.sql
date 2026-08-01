
-- Single source of truth: listing type → workflow key mapping
CREATE TABLE public.listing_type_workflow_map (
  listing_type TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL,
  is_conditional BOOLEAN NOT NULL DEFAULT false,
  condition_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.listing_type_workflow_map ENABLE ROW LEVEL SECURITY;

-- Public read access (admin config, visible to all authenticated users)
CREATE POLICY "Authenticated users can read workflow map"
  ON public.listing_type_workflow_map
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed data matching resolveTransactionType logic
INSERT INTO public.listing_type_workflow_map (listing_type, workflow_key, is_conditional, condition_note) VALUES
  ('cart_purchase', 'cart_purchase', true, 'Final workflow varies by fulfillment type (seller delivery / platform delivery / self-pickup)'),
  ('buy_now', 'cart_purchase', true, 'Final workflow varies by fulfillment type (seller delivery / platform delivery / self-pickup)'),
  ('book_slot', 'service_booking', false, NULL),
  ('request_service', 'request_service', false, NULL),
  ('request_quote', 'request_service', false, NULL),
  ('contact_only', 'request_service', false, NULL),
  ('schedule_visit', 'service_booking', false, NULL);
