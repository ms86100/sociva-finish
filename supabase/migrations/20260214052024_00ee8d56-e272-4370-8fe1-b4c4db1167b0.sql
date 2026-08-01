
-- ============================================
-- COMMUNITY BULLETIN BOARD: All Tables
-- ============================================

-- Table: bulletin_posts
CREATE TABLE public.bulletin_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'alert',
  title text NOT NULL,
  body text,
  attachment_urls text[] DEFAULT '{}',
  is_pinned boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  poll_options jsonb,
  poll_deadline timestamptz,
  event_date timestamptz,
  event_location text,
  rsvp_enabled boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  vote_count integer NOT NULL DEFAULT 0,
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table: bulletin_comments
CREATE TABLE public.bulletin_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: bulletin_votes
CREATE TABLE public.bulletin_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  poll_option_id text,
  vote_type text NOT NULL DEFAULT 'upvote',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, vote_type)
);

-- Table: bulletin_rsvps
CREATE TABLE public.bulletin_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'going',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE public.bulletin_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_rsvps ENABLE ROW LEVEL SECURITY;

-- bulletin_posts policies
CREATE POLICY "Users can view posts in their society"
  ON public.bulletin_posts FOR SELECT
  USING (
    society_id = get_user_society_id(auth.uid()) 
    OR is_admin(auth.uid())
  );

CREATE POLICY "Users can create posts in their society"
  ON public.bulletin_posts FOR INSERT
  WITH CHECK (
    author_id = auth.uid() 
    AND society_id = get_user_society_id(auth.uid())
  );

CREATE POLICY "Authors can update their own posts"
  ON public.bulletin_posts FOR UPDATE
  USING (
    author_id = auth.uid() 
    OR is_admin(auth.uid())
  );

CREATE POLICY "Authors and admins can delete posts"
  ON public.bulletin_posts FOR DELETE
  USING (
    author_id = auth.uid() 
    OR is_admin(auth.uid())
  );

-- bulletin_comments policies
CREATE POLICY "Users can view comments in their society"
  ON public.bulletin_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_comments.post_id
        AND (bp.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Users can create comments on posts in their society"
  ON public.bulletin_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_comments.post_id
        AND bp.society_id = get_user_society_id(auth.uid())
    )
  );

CREATE POLICY "Authors can delete their own comments"
  ON public.bulletin_comments FOR DELETE
  USING (
    author_id = auth.uid() 
    OR is_admin(auth.uid())
  );

-- bulletin_votes policies
CREATE POLICY "Users can view votes in their society"
  ON public.bulletin_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_votes.post_id
        AND (bp.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Users can vote on posts in their society"
  ON public.bulletin_votes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_votes.post_id
        AND bp.society_id = get_user_society_id(auth.uid())
    )
  );

CREATE POLICY "Users can remove their own votes"
  ON public.bulletin_votes FOR DELETE
  USING (user_id = auth.uid());

-- bulletin_rsvps policies
CREATE POLICY "Users can view RSVPs in their society"
  ON public.bulletin_rsvps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_rsvps.post_id
        AND (bp.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Users can RSVP to events in their society"
  ON public.bulletin_rsvps FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_rsvps.post_id
        AND bp.society_id = get_user_society_id(auth.uid())
    )
  );

CREATE POLICY "Users can update their own RSVP"
  ON public.bulletin_rsvps FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own RSVP"
  ON public.bulletin_rsvps FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on bulletin_posts
CREATE TRIGGER update_bulletin_posts_updated_at
  BEFORE UPDATE ON public.bulletin_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Increment/decrement comment_count on bulletin_posts
CREATE OR REPLACE FUNCTION public.update_bulletin_comment_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.bulletin_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.bulletin_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER update_comment_count_on_insert
  AFTER INSERT ON public.bulletin_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_comment_count();

CREATE TRIGGER update_comment_count_on_delete
  AFTER DELETE ON public.bulletin_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_comment_count();

-- Increment/decrement vote_count on bulletin_posts (only for upvotes)
CREATE OR REPLACE FUNCTION public.update_bulletin_vote_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.vote_type = 'upvote' THEN
    UPDATE public.bulletin_posts SET vote_count = vote_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.vote_type = 'upvote' THEN
    UPDATE public.bulletin_posts SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER update_vote_count_on_insert
  AFTER INSERT ON public.bulletin_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_vote_count();

CREATE TRIGGER update_vote_count_on_delete
  AFTER DELETE ON public.bulletin_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_vote_count();

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_bulletin_posts_society ON public.bulletin_posts(society_id);
CREATE INDEX idx_bulletin_posts_category ON public.bulletin_posts(category);
CREATE INDEX idx_bulletin_posts_created ON public.bulletin_posts(created_at DESC);
CREATE INDEX idx_bulletin_posts_pinned ON public.bulletin_posts(is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_bulletin_comments_post ON public.bulletin_comments(post_id);
CREATE INDEX idx_bulletin_votes_post ON public.bulletin_votes(post_id);
CREATE INDEX idx_bulletin_rsvps_post ON public.bulletin_rsvps(post_id);

-- ============================================
-- REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.bulletin_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulletin_comments;
