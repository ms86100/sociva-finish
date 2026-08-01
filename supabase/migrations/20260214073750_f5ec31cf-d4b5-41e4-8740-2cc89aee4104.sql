
-- Create society_features table for per-society feature toggles
CREATE TABLE public.society_features (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(society_id, feature_key)
);

-- Enable RLS
ALTER TABLE public.society_features ENABLE ROW LEVEL SECURITY;

-- Society admins can view features for their society
CREATE POLICY "Society members can view their society features"
  ON public.society_features FOR SELECT
  USING (
    society_id = get_user_society_id(auth.uid())
    OR is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM builder_members bm
      JOIN builder_societies bs ON bs.builder_id = bm.builder_id
      WHERE bm.user_id = auth.uid() AND bs.society_id = society_features.society_id
    )
  );

-- Society admins and platform admins can manage features
CREATE POLICY "Admins can manage society features"
  ON public.society_features FOR ALL
  USING (
    is_admin(auth.uid())
    OR is_society_admin(auth.uid(), society_id)
  );

-- Add society_id to user_notifications for society labeling
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS society_id UUID REFERENCES public.societies(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_society_features_society_id ON public.society_features(society_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_society_id ON public.user_notifications(society_id);
