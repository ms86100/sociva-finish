
-- Add is_under_construction flag to societies
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS is_under_construction boolean NOT NULL DEFAULT false;

-- Construction milestones table
CREATE TABLE public.construction_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  stage text NOT NULL DEFAULT 'foundation',
  photos text[] DEFAULT '{}'::text[],
  completion_percentage integer NOT NULL DEFAULT 0,
  posted_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Milestone reactions table
CREATE TABLE public.milestone_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  milestone_id uuid NOT NULL REFERENCES public.construction_milestones(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  reaction_type text NOT NULL DEFAULT 'thumbsup',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(milestone_id, user_id)
);

-- Enable RLS
ALTER TABLE public.construction_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_reactions ENABLE ROW LEVEL SECURITY;

-- Milestones: anyone in society can view; admins can insert/update
CREATE POLICY "Society members can view milestones"
  ON public.construction_milestones FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Admins can create milestones"
  ON public.construction_milestones FOR INSERT
  WITH CHECK (
    posted_by = auth.uid()
    AND society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can update milestones"
  ON public.construction_milestones FOR UPDATE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

CREATE POLICY "Admins can delete milestones"
  ON public.construction_milestones FOR DELETE
  USING (
    society_id = get_user_society_id(auth.uid())
    AND is_admin(auth.uid())
  );

-- Reactions: society members can view/add/remove
CREATE POLICY "Society members can view reactions"
  ON public.milestone_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM construction_milestones cm
      WHERE cm.id = milestone_reactions.milestone_id
      AND (cm.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Society members can add reactions"
  ON public.milestone_reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM construction_milestones cm
      WHERE cm.id = milestone_reactions.milestone_id
      AND cm.society_id = get_user_society_id(auth.uid())
    )
  );

CREATE POLICY "Users can remove their own reactions"
  ON public.milestone_reactions FOR DELETE
  USING (user_id = auth.uid());
