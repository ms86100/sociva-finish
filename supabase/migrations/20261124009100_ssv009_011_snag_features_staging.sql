-- Staging only (wwuanzbusxoyzixuprxs). SSV-009 / SSV-011.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

CREATE OR REPLACE FUNCTION public.convert_bulletin_post_to_snag(
  _post_id uuid,
  _auto boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
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
  IF v_caller IS NOT NULL THEN
    PERFORM public.sociva_assert_rate_limit('convert_snag:' || v_caller::text, 20, 60);
  END IF;

  IF COALESCE(_auto, false)
     AND pg_trigger_depth() = 0
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND (v_caller IS NULL OR NOT public.is_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

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
    society_id, unit_number, reported_by, category, description, status, priority, title, image_urls, source_post_id
  ) VALUES (
    v_post.society_id, v_unit, v_reporter, v_category,
    left(coalesce(v_post.body, v_post.title, 'Converted from community post'), 2000),
    'reported', 'medium', left(coalesce(v_post.title, 'Community issue'), 200),
    coalesce(v_post.attachment_urls, '{}'::text[]), v_post.id
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
    jsonb_build_object('post_id', v_post.id, 'snag_id', v_snag_id, 'auto', _auto)
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

REVOKE ALL ON FUNCTION public.convert_bulletin_post_to_snag(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_bulletin_post_to_snag(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
RETURNS TABLE(
  feature_key text,
  display_name text,
  is_enabled boolean,
  source text,
  society_configurable boolean,
  description text,
  icon_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _builder_id uuid;
  _builder_package_id uuid;
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN;
  END IF;
  IF auth.role() = 'authenticated'
     AND NOT sociva_private.is_admin(auth.uid())
     AND _society_id IS DISTINCT FROM sociva_private.get_user_society_id(auth.uid()) THEN
    RETURN;
  END IF;

  SELECT bs.builder_id INTO _builder_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  IF _builder_id IS NOT NULL THEN
    SELECT bfp.package_id INTO _builder_package_id
    FROM public.builder_feature_packages bfp
    WHERE bfp.builder_id = _builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    ORDER BY bfp.assigned_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  RETURN QUERY
  WITH package_hits AS (
    SELECT pf.id AS feature_id, pf.feature_key,
      COALESCE(pf.display_name, pf.feature_name, pf.feature_key) AS display_name,
      pf.description, pf.icon_name, pf.is_core, pf.society_configurable,
      fpi.enabled AS package_enabled, 'package'::text AS hit_source, fp.is_default
    FROM public.platform_features pf
    JOIN public.feature_package_items fpi ON fpi.feature_id = pf.id AND fpi.enabled = true
    JOIN public.feature_packages fp ON fp.id = fpi.package_id AND fp.is_active = true
    WHERE pf.is_active = true
      AND (
        fp.is_default = true
        OR (_builder_package_id IS NOT NULL AND fp.id = _builder_package_id)
        OR EXISTS (
          SELECT 1 FROM public.builder_feature_packages bfp2
          WHERE bfp2.builder_id = _builder_id AND bfp2.package_id = fp.id
            AND (bfp2.expires_at IS NULL OR bfp2.expires_at > now())
        )
      )
  ),
  ranked AS (
    SELECT DISTINCT ON (ph.feature_key)
      ph.feature_id, ph.feature_key, ph.display_name, ph.description, ph.icon_name,
      ph.is_core, ph.society_configurable, ph.package_enabled, ph.hit_source
    FROM package_hits ph
    ORDER BY ph.feature_key, ph.is_default DESC
  )
  SELECT r.feature_key, r.display_name,
    CASE WHEN r.is_core THEN true WHEN sfo.id IS NOT NULL THEN sfo.is_enabled ELSE COALESCE(r.package_enabled, false) END,
    CASE WHEN r.is_core THEN 'core' WHEN sfo.id IS NOT NULL THEN 'override' ELSE r.hit_source END,
    CASE WHEN r.is_core THEN false WHEN COALESCE(r.society_configurable, true) = false THEN false ELSE true END,
    r.description, r.icon_name
  FROM ranked r
  LEFT JOIN public.society_feature_overrides sfo
    ON sfo.feature_id = r.feature_id AND sfo.society_id = _society_id
  ORDER BY r.feature_key;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_society_features(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_society_features(uuid) TO authenticated, service_role;
