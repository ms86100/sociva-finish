
-- Phase 1: Silent Dispute System

-- Table: dispute_tickets
CREATE TABLE public.dispute_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  category text NOT NULL DEFAULT 'other',
  description text NOT NULL,
  photo_urls text[] DEFAULT '{}'::text[],
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'submitted',
  sla_deadline timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispute_tickets ENABLE ROW LEVEL SECURITY;

-- Submitters see own tickets; admins see all in society
-- For anonymous tickets, non-admins cannot see submitted_by via a view, but RLS scopes row access
CREATE POLICY "Users can view own tickets"
  ON public.dispute_tickets FOR SELECT
  USING (
    submitted_by = auth.uid()
    OR (society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()))
  );

CREATE POLICY "Users can create tickets in their society"
  ON public.dispute_tickets FOR INSERT
  WITH CHECK (
    submitted_by = auth.uid()
    AND society_id = get_user_society_id(auth.uid())
  );

CREATE POLICY "Admins can update tickets in their society"
  ON public.dispute_tickets FOR UPDATE
  USING (
    society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid())
  );

-- Table: dispute_comments
CREATE TABLE public.dispute_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.dispute_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id),
  body text NOT NULL,
  is_committee_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispute_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments on accessible tickets"
  ON public.dispute_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dispute_tickets dt
      WHERE dt.id = dispute_comments.ticket_id
      AND (
        dt.submitted_by = auth.uid()
        OR (dt.society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()))
      )
    )
  );

CREATE POLICY "Users can add comments to accessible tickets"
  ON public.dispute_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.dispute_tickets dt
      WHERE dt.id = dispute_comments.ticket_id
      AND (
        dt.submitted_by = auth.uid()
        OR (dt.society_id = get_user_society_id(auth.uid()) AND is_admin(auth.uid()))
      )
    )
  );
