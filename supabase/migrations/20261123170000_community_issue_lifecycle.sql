-- Community issue lifecycle: auto-convert at 100 votes, milestones, ask-committee,
-- society-wide visibility for community-linked snags, soft close helpers.

-- ---------------------------------------------------------------------------
-- 0. Dedupe vote-count triggers (insert/delete were firing twice)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_vote_count_on_insert ON public.bulletin_votes;
DROP TRIGGER IF EXISTS update_vote_count_on_delete ON public.bulletin_votes;

-- ---------------------------------------------------------------------------
-- 1. Notify society admins helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_society_admins_issue(
  _society_id uuid,
  _title text,
  _body text,
  _action_url text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, action_url, society_id, payload
  )
  SELECT
    sa.user_id,
    _title,
    _body,
    'community_issue',
    _action_url,
    _action_url,
    _society_id,
    _payload
  FROM public.society_admins sa
  WHERE sa.society_id = _society_id
    AND sa.deactivated_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Core convert (manual + auto). Auto uses post author as reported_by.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convert_bulletin_post_to_snag(uuid);
DROP FUNCTION IF EXISTS public.convert_bulletin_post_to_snag(uuid, boolean);

CREATE OR REPLACE FUNCTION public.convert_bulletin_post_to_snag(
  _post_id uuid,
  _auto boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_post public.bulletin_posts%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_reporter uuid;
  v_snag_id uuid;
  v_unit text;
  v_category text;
  v_existing uuid;
BEGIN
  SELECT * INTO v_post FROM public.bulletin_posts WHERE id = _post_id;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.structured ? 'converted_snag_id' THEN
    RETURN jsonb_build_object(
      'snag_id', v_post.structured->>'converted_snag_id',
      'already_converted', true
    );
  END IF;

  SELECT id INTO v_existing FROM public.snag_tickets WHERE source_post_id = _post_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE public.bulletin_posts
    SET structured = coalesce(structured, '{}'::jsonb)
      || jsonb_build_object('converted_snag_id', v_existing),
        updated_at = now()
    WHERE id = v_post.id
      AND NOT (coalesce(structured, '{}'::jsonb) ? 'converted_snag_id');
    RETURN jsonb_build_object('snag_id', v_existing, 'already_converted', true);
  END IF;

  IF _auto THEN
    -- Trigger / system path: maintenance|alert only, vote_count >= 100
    IF v_post.category NOT IN ('maintenance', 'alert') THEN
      RETURN jsonb_build_object('skipped', true, 'reason', 'category');
    END IF;
    IF coalesce(v_post.vote_count, 0) < 100 THEN
      RETURN jsonb_build_object('skipped', true, 'reason', 'threshold');
    END IF;
    v_reporter := v_post.author_id;
  ELSE
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF v_post.society_id <> public.get_user_society_id(v_caller)
       AND NOT public.is_admin(v_caller) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    IF v_post.author_id <> v_caller
       AND NOT public.is_admin(v_caller)
       AND NOT public.is_society_admin(v_caller, v_post.society_id) THEN
      RAISE EXCEPTION 'Only the author or a society admin can convert this post';
    END IF;
    IF v_post.category NOT IN ('maintenance', 'alert', 'find_help') THEN
      RAISE EXCEPTION 'This category cannot be converted to an issue';
    END IF;
    v_reporter := v_caller;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_reporter;
  v_unit := coalesce(
    nullif(trim(coalesce(v_profile.block, '') || '-' || coalesce(v_profile.flat_number, '')), '-'),
    'Unknown'
  );

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
    v_reporter,
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
      structured = coalesce(structured, '{}'::jsonb)
        || jsonb_build_object('converted_snag_id', v_snag_id, 'snag_status', 'reported')
        || CASE WHEN _auto THEN jsonb_build_object('auto_converted_at', now()) ELSE '{}'::jsonb END,
      updated_at = now()
  WHERE id = v_post.id;

  PERFORM public.notify_society_admins_issue(
    v_post.society_id,
    CASE WHEN _auto THEN 'Community issue auto-opened' ELSE 'Community issue opened' END,
    left(coalesce(v_post.title, 'A community post'), 120) || ' is now a tracked issue.',
    '/society/snags?id=' || v_snag_id::text,
    jsonb_build_object(
      'post_id', v_post.id,
      'snag_id', v_snag_id,
      'auto', _auto
    )
  );

  IF v_post.author_id IS NOT NULL AND (v_caller IS NULL OR v_post.author_id <> v_caller) THEN
    INSERT INTO public.notification_queue (
      user_id, title, body, type, reference_path, action_url, society_id, payload
    ) VALUES (
      v_post.author_id,
      CASE WHEN _auto THEN 'Your post became an issue' ELSE 'Your post was converted to an issue' END,
      left(coalesce(v_post.title, 'Your community post'), 120) || ' is now tracked by the committee.',
      'community_issue',
      '/society/snags?id=' || v_snag_id::text,
      '/society/snags?id=' || v_snag_id::text,
      v_post.society_id,
      jsonb_build_object('post_id', v_post.id, 'snag_id', v_snag_id, 'auto', _auto)
    );
  END IF;

  RETURN jsonb_build_object('snag_id', v_snag_id, 'already_converted', false, 'auto', _auto);
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_bulletin_post_to_snag(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_bulletin_post_to_snag(uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. After vote_count changes: milestones 25/50 + auto at 100
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulletin_issue_meter_on_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.bulletin_posts%ROWTYPE;
  v_structured jsonb;
  v_votes integer;
BEGIN
  -- Only react when vote_count changed
  IF TG_OP = 'UPDATE' AND NEW.vote_count IS NOT DISTINCT FROM OLD.vote_count THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_post FROM public.bulletin_posts WHERE id = NEW.id;
  IF v_post.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_post.category NOT IN ('maintenance', 'alert') THEN
    RETURN NEW;
  END IF;

  IF coalesce(v_post.structured, '{}'::jsonb) ? 'converted_snag_id' THEN
    RETURN NEW;
  END IF;

  v_votes := coalesce(NEW.vote_count, 0);
  v_structured := coalesce(v_post.structured, '{}'::jsonb);

  IF v_votes >= 25 AND NOT (v_structured ? 'issue_meter_notified_25') THEN
    v_structured := v_structured || jsonb_build_object('issue_meter_notified_25', true);
    PERFORM public.notify_society_admins_issue(
      v_post.society_id,
      'Issue gaining neighbour support',
      left(coalesce(v_post.title, 'A post'), 100) || ' has 25+ upvotes.',
      '/bulletin',
      jsonb_build_object('post_id', v_post.id, 'vote_count', v_votes, 'milestone', 25)
    );
  END IF;

  IF v_votes >= 50 AND NOT (v_structured ? 'issue_meter_notified_50') THEN
    v_structured := v_structured || jsonb_build_object('issue_meter_notified_50', true);
    PERFORM public.notify_society_admins_issue(
      v_post.society_id,
      'Issue nearing auto-open',
      left(coalesce(v_post.title, 'A post'), 100) || ' has 50+ upvotes (auto-opens at 100).',
      '/bulletin',
      jsonb_build_object('post_id', v_post.id, 'vote_count', v_votes, 'milestone', 50)
    );
  END IF;

  IF v_structured IS DISTINCT FROM coalesce(v_post.structured, '{}'::jsonb) THEN
    UPDATE public.bulletin_posts
    SET structured = v_structured, updated_at = now()
    WHERE id = v_post.id;
  END IF;

  IF v_votes >= 100 THEN
    PERFORM public.convert_bulletin_post_to_snag(v_post.id, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulletin_issue_meter_on_vote ON public.bulletin_posts;
CREATE TRIGGER trg_bulletin_issue_meter_on_vote
  AFTER UPDATE OF vote_count ON public.bulletin_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.bulletin_issue_meter_on_vote();

-- ---------------------------------------------------------------------------
-- 4. Ask committee (notify only, rate-limited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_committee_open_issue(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_post public.bulletin_posts%ROWTYPE;
  v_structured jsonb;
  v_last timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_post FROM public.bulletin_posts WHERE id = _post_id;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.society_id <> public.get_user_society_id(v_caller)
     AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_post.category NOT IN ('maintenance', 'alert') THEN
    RAISE EXCEPTION 'Only maintenance or alert posts can request an issue';
  END IF;

  IF coalesce(v_post.vote_count, 0) < 25 THEN
    RAISE EXCEPTION 'Need at least 25 upvotes before asking the committee';
  END IF;

  IF coalesce(v_post.structured, '{}'::jsonb) ? 'converted_snag_id' THEN
    RETURN jsonb_build_object('ok', true, 'already_converted', true);
  END IF;

  v_structured := coalesce(v_post.structured, '{}'::jsonb);
  IF v_structured ? 'ask_committee_at' THEN
    v_last := (v_structured->>'ask_committee_at')::timestamptz;
    IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN
      RETURN jsonb_build_object('ok', true, 'rate_limited', true);
    END IF;
  END IF;

  UPDATE public.bulletin_posts
  SET structured = v_structured || jsonb_build_object(
        'ask_committee_at', now(),
        'ask_committee_by', v_caller
      ),
      updated_at = now()
  WHERE id = v_post.id;

  PERFORM public.notify_society_admins_issue(
    v_post.society_id,
    'Residents asked to open an issue',
    left(coalesce(v_post.title, 'A community post'), 120)
      || ' (' || coalesce(v_post.vote_count, 0)::text || ' upvotes).',
    '/bulletin',
    jsonb_build_object('post_id', v_post.id, 'requested_by', v_caller)
  );

  RETURN jsonb_build_object('ok', true, 'rate_limited', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_committee_open_issue(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Keep post.structured.snag_status in sync when snag updates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_bulletin_snag_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_post_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE public.bulletin_posts
  SET structured = coalesce(structured, '{}'::jsonb)
        || jsonb_build_object('snag_status', NEW.status),
      updated_at = now()
  WHERE id = NEW.source_post_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bulletin_snag_status ON public.snag_tickets;
CREATE TRIGGER trg_sync_bulletin_snag_status
  AFTER INSERT OR UPDATE OF status ON public.snag_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bulletin_snag_status();

-- ---------------------------------------------------------------------------
-- 6. Soft auto-close: resolved for 7+ days with no reopen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_close_resolved_community_snags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.snag_tickets
    SET status = 'closed',
        resolved_at = coalesce(resolved_at, now()),
        updated_at = now()
    WHERE status = 'resolved'
      AND source_post_id IS NOT NULL
      AND coalesce(updated_at, created_at) < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_close_resolved_community_snags() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS transparency: society members see community-linked snags;
--    society admins can update society snags
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own snags" ON public.snag_tickets;
CREATE POLICY "Users can view own snags"
  ON public.snag_tickets
  FOR SELECT
  TO authenticated
  USING (
    reported_by = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR (
      society_id = public.get_user_society_id(auth.uid())
      AND source_post_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Admins can update snags" ON public.snag_tickets;
CREATE POLICY "Admins can update snags"
  ON public.snag_tickets
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR reported_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR reported_by = auth.uid()
  );
