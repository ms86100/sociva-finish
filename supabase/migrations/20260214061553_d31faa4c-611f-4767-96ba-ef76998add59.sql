
-- Emergency broadcasts table
CREATE TABLE public.emergency_broadcasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id),
  sent_by UUID NOT NULL REFERENCES public.profiles(id),
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can create broadcasts"
  ON public.emergency_broadcasts FOR INSERT
  WITH CHECK (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()) AND sent_by = auth.uid());

CREATE POLICY "Society members can view broadcasts"
  ON public.emergency_broadcasts FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can delete broadcasts"
  ON public.emergency_broadcasts FOR DELETE
  USING (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()));
