-- Silent Smart Conversations: category prefs, snag link, TTL expire helper, convert RPC.
-- Does not replace Conversations MVP or Smart Groups.

-- ---------------------------------------------------------------------------
-- 1. Category follow / mute
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bulletin_category_prefs (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  category text NOT NULL,
  mode text NOT NULL CHECK (mode = ANY (ARRAY['follow'::text, 'mute'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, society_id, category)
);

CREATE INDEX IF NOT EXISTS bulletin_category_prefs_society_user_idx
  ON public.bulletin_category_prefs (society_id, user_id);

ALTER TABLE public.bulletin_category_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulletin_category_prefs_select_own ON public.bulletin_category_prefs;
CREATE POLICY bulletin_category_prefs_select_own ON public.bulletin_category_prefs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS bulletin_category_prefs_insert_own ON public.bulletin_category_prefs;
CREATE POLICY bulletin_category_prefs_insert_own ON public.bulletin_category_prefs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS bulletin_category_prefs_update_own ON public.bulletin_category_prefs;
CREATE POLICY bulletin_category_prefs_update_own ON public.bulletin_category_prefs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bulletin_category_prefs_delete_own ON public.bulletin_category_prefs;
CREATE POLICY bulletin_category_prefs_delete_own ON public.bulletin_category_prefs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Link snags back to bulletin posts
-- ---------------------------------------------------------------------------
ALTER TABLE public.snag_tickets
  ADD COLUMN IF NOT EXISTS source_post_id uuid REFERENCES public.bulletin_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS snag_tickets_source_post_idx
  ON public.snag_tickets (source_post_id)
  WHERE source_post_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Expire posts by expires_at (soft archive, keep history)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_bulletin_posts_by_ttl()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.bulletin_posts
    SET status = 'expired',
        is_archived = true,
        updated_at = now()
    WHERE is_archived = false
      AND is_pinned = false
      AND expires_at IS NOT NULL
      AND expires_at < now()
      AND coalesce(status, 'open') <> 'expired'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_bulletin_posts_by_ttl() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Convert bulletin post to snag issue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_bulletin_post_to_snag(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_post public.bulletin_posts%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_snag_id uuid;
  v_unit text;
  v_category text;
  v_existing uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_post FROM public.bulletin_posts WHERE id = _post_id;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.society_id <> public.get_user_society_id(v_caller) AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_post.author_id <> v_caller
     AND NOT public.is_admin(v_caller)
     AND NOT public.is_society_admin(v_caller, v_post.society_id) THEN
    RAISE EXCEPTION 'Only the author or a society admin can convert this post';
  END IF;

  IF v_post.structured ? 'converted_snag_id' THEN
    RETURN jsonb_build_object(
      'snag_id', v_post.structured->>'converted_snag_id',
      'already_converted', true
    );
  END IF;

  SELECT id INTO v_existing FROM public.snag_tickets WHERE source_post_id = _post_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('snag_id', v_existing, 'already_converted', true);
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  v_unit := coalesce(nullif(trim(coalesce(v_profile.block, '') || '-' || coalesce(v_profile.flat_number, '')), '-'), 'Unknown');

  v_category := CASE
    WHEN v_post.category = 'maintenance' THEN 'common_area'
    WHEN v_post.service_category IN ('electrician', 'ac_service') THEN 'electrical'
    WHEN v_post.service_category = 'plumber' THEN 'plumbing'
    WHEN v_post.service_category = 'carpenter' THEN 'carpentry'
    WHEN lower(coalesce(v_post.title, '') || ' ' || coalesce(v_post.body, '')) LIKE '%lift%' THEN 'lift'
    ELSE 'other'
  END;

  INSERT INTO public.snag_tickets (
    society_id,
    unit_number,
    reported_by,
    category,
    description,
    status,
    priority,
    title,
    image_urls,
    source_post_id
  ) VALUES (
    v_post.society_id,
    v_unit,
    v_caller,
    v_category,
    left(coalesce(v_post.body, v_post.title, 'Converted from community post'), 2000),
    'reported',
    'medium',
    left(coalesce(v_post.title, 'Community issue'), 200),
    coalesce(v_post.attachment_urls, '{}'::text[]),
    v_post.id
  )
  RETURNING id INTO v_snag_id;

  UPDATE public.bulletin_posts
  SET status = 'closed',
      structured = coalesce(structured, '{}'::jsonb) || jsonb_build_object('converted_snag_id', v_snag_id),
      updated_at = now()
  WHERE id = v_post.id;

  RETURN jsonb_build_object('snag_id', v_snag_id, 'already_converted', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_bulletin_post_to_snag(uuid) TO authenticated;
