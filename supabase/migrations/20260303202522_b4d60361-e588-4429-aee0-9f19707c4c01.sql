
-- Create campaigns table for push notification campaign history
CREATE TABLE public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  target_platform text NOT NULL DEFAULT 'all',
  target_user_ids uuid[] DEFAULT '{}',
  target_society_id uuid REFERENCES public.societies(id),
  sent_by uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'sending',
  targeted_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  cleaned_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Admin-only policies using has_role
CREATE POLICY "Admins can read campaigns"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert campaigns"
  ON public.campaigns FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update campaigns"
  ON public.campaigns FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX idx_campaigns_created_at ON public.campaigns (created_at DESC);
CREATE INDEX idx_campaigns_sent_by ON public.campaigns (sent_by);
CREATE INDEX idx_campaigns_status ON public.campaigns (status);
