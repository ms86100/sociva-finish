-- Sociva Conversations MVP: same-society verified resident DMs + Smart Groups context.
-- No marketplace seller DMs, no group chats, no video in this phase.

-- ---------------------------------------------------------------------------
-- 1. Feature flag
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_features (
  feature_key,
  feature_name,
  display_name,
  description,
  tagline,
  category,
  is_core,
  society_configurable,
  route,
  icon_name,
  audience,
  capabilities
)
VALUES (
  'conversations',
  'Conversations',
  'Messages',
  'Private neighbour messaging linked to Smart Groups posts, with message requests and image sharing.',
  'See a post. Connect privately. Solve it.',
  'community',
  false,
  true,
  '/messages',
  'MessageCircle',
  ARRAY['Resident', 'Society Admin'],
  ARRAY[
    'Private 1:1 neighbour chat',
    'Message requests',
    'Contextual chat from Smart Groups',
    'Image and camera attachments',
    'Edit and delete own messages'
  ]
)
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  tagline = EXCLUDED.tagline,
  route = EXCLUDED.route,
  icon_name = EXCLUDED.icon_name,
  society_configurable = EXCLUDED.society_configurable,
  is_active = true;

INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE fp.is_default = true
  AND fp.is_active = true
  AND pf.feature_key = 'conversations'
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_package_items x
    WHERE x.package_id = fp.id AND x.feature_id = pf.id
  );

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'direct' CHECK (kind = 'direct'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'declined'::text])),
  direct_pair_key text,
  context_post_id uuid REFERENCES public.bulletin_posts(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_key_uidx
  ON public.conversations (society_id, direct_pair_key)
  WHERE direct_pair_key IS NOT NULL AND kind = 'direct';

CREATE INDEX IF NOT EXISTS conversations_society_last_msg_idx
  ON public.conversations (society_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS conversations_context_post_idx
  ON public.conversations (context_post_id)
  WHERE context_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role = ANY (ARRAY['member'::text, 'admin'::text])),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted_until timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON public.conversation_members (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  client_idempotency_key text,
  CONSTRAINT conversation_messages_body_len CHECK (char_length(body) <= 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_idempotency_uidx
  ON public.conversation_messages (conversation_id, sender_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_messages_conv_created_idx
  ON public.conversation_messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  content_type text NOT NULL DEFAULT 'image/jpeg',
  byte_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_attachments_image_only CHECK (
    content_type LIKE 'image/%'
  )
);

CREATE INDEX IF NOT EXISTS conversation_attachments_message_idx
  ON public.conversation_message_attachments (message_id);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT user_blocks_unique UNIQUE (society_id, blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON public.user_blocks (society_id, blocked_id);

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversations_direct_pair_key(a uuid, b uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN a::text < b::text THEN a::text || ':' || b::text
    ELSE b::text || ':' || a::text
  END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_is_approved_resident(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.society_id = _society_id
      AND p.verification_status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.conversations_is_blocked(_society_id uuid, _a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE ub.society_id = _society_id
      AND (
        (ub.blocker_id = _a AND ub.blocked_id = _b)
        OR (ub.blocker_id = _b AND ub.blocked_id = _a)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.conversations_is_member(_conversation_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = _conversation_id
      AND cm.user_id = _user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select_member ON public.conversations;
CREATE POLICY conversations_select_member ON public.conversations
  FOR SELECT TO authenticated
  USING (
    public.conversations_is_member(id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_members_select ON public.conversation_members;
CREATE POLICY conversation_members_select ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    public.conversations_is_member(conversation_id, auth.uid())
    OR user_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_members_update_self ON public.conversation_members;
CREATE POLICY conversation_members_update_self ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversation_messages_select ON public.conversation_messages;
CREATE POLICY conversation_messages_select ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    public.conversations_is_member(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_attachments_select ON public.conversation_message_attachments;
CREATE POLICY conversation_attachments_select ON public.conversation_message_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_messages m
      WHERE m.id = message_id
        AND public.conversations_is_member(m.conversation_id, auth.uid())
    )
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (
    blocker_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
  );

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversations_open_or_request(
  _target_user_id uuid,
  _first_message text,
  _context_post_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
  v_pair text;
  v_conv public.conversations%ROWTYPE;
  v_msg public.conversation_messages%ROWTYPE;
  v_body text := trim(coalesce(_first_message, ''));
  v_pending_today int;
  v_post_society uuid;
  v_is_new boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _target_user_id IS NULL OR _target_user_id = v_caller THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;

  v_society := public.get_user_society_id(v_caller);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'No society';
  END IF;

  IF NOT public.can_access_feature(v_society, 'conversations') THEN
    RAISE EXCEPTION 'Conversations not enabled';
  END IF;

  IF NOT public.conversations_is_approved_resident(v_caller, v_society) THEN
    RAISE EXCEPTION 'Only verified residents can message';
  END IF;
  IF NOT public.conversations_is_approved_resident(_target_user_id, v_society) THEN
    RAISE EXCEPTION 'Recipient must be a verified resident in your society';
  END IF;
  IF public.conversations_is_blocked(v_society, v_caller, _target_user_id) THEN
    RAISE EXCEPTION 'Messaging blocked';
  END IF;

  IF _context_post_id IS NOT NULL THEN
    SELECT society_id INTO v_post_society
    FROM public.bulletin_posts
    WHERE id = _context_post_id AND is_archived = false;
    IF v_post_society IS NULL OR v_post_society <> v_society THEN
      RAISE EXCEPTION 'Invalid post context';
    END IF;
  END IF;

  v_pair := public.conversations_direct_pair_key(v_caller, _target_user_id);

  SELECT * INTO v_conv
  FROM public.conversations c
  WHERE c.society_id = v_society
    AND c.kind = 'direct'
    AND c.direct_pair_key = v_pair
  LIMIT 1;

  IF v_conv.id IS NULL THEN
    IF char_length(v_body) < 1 THEN
      RAISE EXCEPTION 'Message required';
    END IF;

    SELECT count(*)::int INTO v_pending_today
    FROM public.conversations c
    WHERE c.created_by = v_caller
      AND c.status = 'pending'
      AND c.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

    IF v_pending_today >= 20 THEN
      RAISE EXCEPTION 'Daily message request limit reached';
    END IF;

    INSERT INTO public.conversations (
      society_id, kind, status, direct_pair_key, context_post_id, created_by,
      last_message_at, last_message_preview
    ) VALUES (
      v_society, 'direct', 'pending', v_pair, _context_post_id, v_caller,
      now(), left(v_body, 140)
    )
    RETURNING * INTO v_conv;

    INSERT INTO public.conversation_members (conversation_id, user_id, role, last_read_at)
    VALUES
      (v_conv.id, v_caller, 'member', now()),
      (v_conv.id, _target_user_id, 'member', NULL);

    v_is_new := true;
  ELSE
    IF v_conv.status = 'declined' THEN
      -- Re-open as a fresh request from the other party or same party
      UPDATE public.conversations
      SET status = 'pending',
          created_by = v_caller,
          context_post_id = coalesce(_context_post_id, context_post_id),
          updated_at = now(),
          last_message_at = now(),
          last_message_preview = left(v_body, 140)
      WHERE id = v_conv.id
      RETURNING * INTO v_conv;
    ELSIF v_conv.status = 'pending' AND v_conv.created_by <> v_caller THEN
      -- Recipient messaging back while pending accepts + continues
      UPDATE public.conversations
      SET status = 'active',
          context_post_id = coalesce(_context_post_id, context_post_id),
          updated_at = now()
      WHERE id = v_conv.id
      RETURNING * INTO v_conv;
    ELSIF v_conv.status = 'active' AND _context_post_id IS NOT NULL AND v_conv.context_post_id IS NULL THEN
      UPDATE public.conversations
      SET context_post_id = _context_post_id, updated_at = now()
      WHERE id = v_conv.id
      RETURNING * INTO v_conv;
    END IF;
  END IF;

  IF v_conv.status = 'pending' AND v_conv.created_by <> v_caller THEN
    RAISE EXCEPTION 'Waiting for the other person to accept your request';
  END IF;

  -- Pending requester may only send the initial request message (no spam).
  IF v_conv.status = 'pending' AND v_conv.created_by = v_caller THEN
    IF EXISTS (
      SELECT 1 FROM public.conversation_messages m WHERE m.conversation_id = v_conv.id
    ) AND char_length(v_body) > 0 AND NOT v_is_new THEN
      RETURN jsonb_build_object(
        'conversation_id', v_conv.id,
        'status', v_conv.status,
        'message_id', null,
        'is_new', false
      );
    END IF;
  END IF;

  IF char_length(v_body) > 0 THEN
    IF _idempotency_key IS NOT NULL THEN
      SELECT * INTO v_msg
      FROM public.conversation_messages
      WHERE conversation_id = v_conv.id
        AND sender_id = v_caller
        AND client_idempotency_key = _idempotency_key
      LIMIT 1;
    END IF;

    IF v_msg.id IS NULL THEN
      INSERT INTO public.conversation_messages (
        conversation_id, sender_id, body, client_idempotency_key
      ) VALUES (
        v_conv.id, v_caller, v_body, _idempotency_key
      )
      RETURNING * INTO v_msg;

      UPDATE public.conversations
      SET last_message_at = v_msg.created_at,
          last_message_preview = left(v_body, 140),
          updated_at = now()
      WHERE id = v_conv.id;

      UPDATE public.conversation_members
      SET last_read_at = now()
      WHERE conversation_id = v_conv.id AND user_id = v_caller;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conv.id,
    'status', v_conv.status,
    'message_id', v_msg.id,
    'is_new', v_is_new
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_respond_request(
  _conversation_id uuid,
  _accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = _conversation_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF NOT public.conversations_is_member(_conversation_id, v_caller) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;
  IF v_conv.status <> 'pending' THEN
    RETURN jsonb_build_object('conversation_id', v_conv.id, 'status', v_conv.status);
  END IF;
  IF v_conv.created_by = v_caller THEN
    RAISE EXCEPTION 'Cannot respond to your own request';
  END IF;

  UPDATE public.conversations
  SET status = CASE WHEN _accept THEN 'active' ELSE 'declined' END,
      updated_at = now()
  WHERE id = _conversation_id
  RETURNING * INTO v_conv;

  IF _accept THEN
    UPDATE public.conversation_members
    SET last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = v_caller;
  END IF;

  RETURN jsonb_build_object('conversation_id', v_conv.id, 'status', v_conv.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_send_message(
  _conversation_id uuid,
  _body text,
  _idempotency_key text DEFAULT NULL,
  _attachment_paths text[] DEFAULT NULL,
  _attachment_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_msg public.conversation_messages%ROWTYPE;
  v_body text := trim(coalesce(_body, ''));
  v_paths text[] := coalesce(_attachment_paths, ARRAY[]::text[]);
  v_types text[] := coalesce(_attachment_types, ARRAY[]::text[]);
  v_i int;
  v_path text;
  v_ctype text;
  v_other uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.conversations_is_member(_conversation_id, v_caller) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = _conversation_id;
  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF v_conv.status = 'declined' THEN
    RAISE EXCEPTION 'Conversation declined';
  END IF;
  IF v_conv.status = 'pending' AND v_conv.created_by <> v_caller THEN
    RAISE EXCEPTION 'Accept the request before messaging';
  END IF;
  IF v_conv.status = 'pending' AND v_conv.created_by = v_caller THEN
    RAISE EXCEPTION 'Wait for acceptance before sending more messages';
  END IF;
  IF v_conv.status <> 'active' THEN
    RAISE EXCEPTION 'Conversation not active';
  END IF;

  IF char_length(v_body) < 1 AND coalesce(array_length(v_paths, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Empty message';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;
  IF coalesce(array_length(v_paths, 1), 0) > 4 THEN
    RAISE EXCEPTION 'Max 4 images per message';
  END IF;

  SELECT cm.user_id INTO v_other
  FROM public.conversation_members cm
  WHERE cm.conversation_id = _conversation_id AND cm.user_id <> v_caller
  LIMIT 1;

  IF public.conversations_is_blocked(v_conv.society_id, v_caller, v_other) THEN
    RAISE EXCEPTION 'Messaging blocked';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_msg
    FROM public.conversation_messages
    WHERE conversation_id = _conversation_id
      AND sender_id = v_caller
      AND client_idempotency_key = _idempotency_key
    LIMIT 1;
  END IF;

  IF v_msg.id IS NULL THEN
    INSERT INTO public.conversation_messages (
      conversation_id, sender_id, body, client_idempotency_key
    ) VALUES (
      _conversation_id,
      v_caller,
      CASE WHEN char_length(v_body) = 0 THEN '' ELSE v_body END,
      _idempotency_key
    )
    RETURNING * INTO v_msg;

    FOR v_i IN 1..coalesce(array_length(v_paths, 1), 0) LOOP
      v_path := v_paths[v_i];
      v_ctype := coalesce(v_types[v_i], 'image/jpeg');
      IF v_path IS NULL OR position(v_caller::text || '/conversations/' IN v_path) <> 1 THEN
        RAISE EXCEPTION 'Invalid attachment path';
      END IF;
      IF v_ctype NOT LIKE 'image/%' THEN
        RAISE EXCEPTION 'Only image attachments allowed';
      END IF;
      INSERT INTO public.conversation_message_attachments (message_id, storage_path, content_type)
      VALUES (v_msg.id, v_path, v_ctype);
    END LOOP;

    UPDATE public.conversations
    SET last_message_at = v_msg.created_at,
        last_message_preview = CASE
          WHEN char_length(v_body) > 0 THEN left(v_body, 140)
          ELSE 'Photo'
        END,
        updated_at = now()
    WHERE id = _conversation_id;

    UPDATE public.conversation_members
    SET last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = v_caller;
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_msg.id,
    'conversation_id', _conversation_id,
    'created_at', v_msg.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_edit_message(
  _message_id uuid,
  _body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_msg public.conversation_messages%ROWTYPE;
  v_body text := trim(coalesce(_body, ''));
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Invalid message body';
  END IF;

  SELECT * INTO v_msg FROM public.conversation_messages WHERE id = _message_id;
  IF v_msg.id IS NULL THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF v_msg.sender_id <> v_caller THEN RAISE EXCEPTION 'Only sender can edit'; END IF;
  IF v_msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message deleted'; END IF;
  IF v_msg.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Edit window expired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversation_message_attachments a WHERE a.message_id = v_msg.id
  ) AND char_length(v_msg.body) = 0 THEN
    -- allow caption edit on image messages
    NULL;
  END IF;

  UPDATE public.conversation_messages
  SET body = v_body, edited_at = now()
  WHERE id = _message_id
  RETURNING * INTO v_msg;

  UPDATE public.conversations c
  SET last_message_preview = left(v_body, 140), updated_at = now()
  WHERE c.id = v_msg.conversation_id
    AND c.last_message_at = v_msg.created_at;

  RETURN jsonb_build_object('message_id', v_msg.id, 'edited_at', v_msg.edited_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_delete_message(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_msg public.conversation_messages%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_msg FROM public.conversation_messages WHERE id = _message_id;
  IF v_msg.id IS NULL THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF v_msg.sender_id <> v_caller THEN RAISE EXCEPTION 'Only sender can delete'; END IF;
  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('message_id', v_msg.id, 'deleted_at', v_msg.deleted_at);
  END IF;

  UPDATE public.conversation_messages
  SET deleted_at = now(), body = ''
  WHERE id = _message_id
  RETURNING * INTO v_msg;

  UPDATE public.conversations c
  SET last_message_preview = 'Message deleted', updated_at = now()
  WHERE c.id = v_msg.conversation_id
    AND c.last_message_at = v_msg.created_at;

  RETURN jsonb_build_object('message_id', v_msg.id, 'deleted_at', v_msg.deleted_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_mark_read(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.conversations_is_member(_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;
  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_inbox(_limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (
  conversation_id uuid,
  status text,
  other_user_id uuid,
  other_name text,
  other_block text,
  other_flat text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  context_post_id uuid,
  context_post_title text,
  context_post_category text,
  is_request boolean,
  am_requester boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.status,
    op.id,
    op.name,
    op.block,
    op.flat_number,
    c.last_message_at,
    c.last_message_preview,
    (
      SELECT count(*)::bigint
      FROM public.conversation_messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> v_caller
        AND m.deleted_at IS NULL
        AND (cm_me.last_read_at IS NULL OR m.created_at > cm_me.last_read_at)
    ) AS unread_count,
    c.context_post_id,
    bp.title,
    bp.category,
    (c.status = 'pending') AS is_request,
    (c.created_by = v_caller) AS am_requester
  FROM public.conversation_members cm_me
  JOIN public.conversations c ON c.id = cm_me.conversation_id
  JOIN public.conversation_members cm_other
    ON cm_other.conversation_id = c.id AND cm_other.user_id <> v_caller
  JOIN public.profiles op ON op.id = cm_other.user_id
  LEFT JOIN public.bulletin_posts bp ON bp.id = c.context_post_id
  WHERE cm_me.user_id = v_caller
    AND c.status <> 'declined'
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
  LIMIT greatest(1, least(coalesce(_limit, 50), 100))
  OFFSET greatest(0, coalesce(_offset, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_unread_count()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count bigint := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(sub.unread), 0)::bigint INTO v_count
  FROM (
    SELECT (
      SELECT count(*)::bigint
      FROM public.conversation_messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> v_caller
        AND m.deleted_at IS NULL
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    ) AS unread
    FROM public.conversation_members cm
    JOIN public.conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = v_caller
      AND c.status IN ('active', 'pending')
  ) sub;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_block_user(_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _blocked_id IS NULL OR _blocked_id = v_caller THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;
  v_society := public.get_user_society_id(v_caller);
  IF v_society IS NULL THEN RAISE EXCEPTION 'No society'; END IF;

  INSERT INTO public.user_blocks (society_id, blocker_id, blocked_id)
  VALUES (v_society, v_caller, _blocked_id)
  ON CONFLICT (society_id, blocker_id, blocked_id) DO NOTHING;

  UPDATE public.conversations c
  SET status = 'declined', updated_at = now()
  WHERE c.society_id = v_society
    AND c.kind = 'direct'
    AND c.direct_pair_key = public.conversations_direct_pair_key(v_caller, _blocked_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Notify on new messages / requests
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_conversation_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
  v_recipient uuid;
  v_sender_name text;
  v_muted boolean;
  v_type text;
  v_title text;
  v_body text;
BEGIN
  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cm.user_id INTO v_recipient
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id
  LIMIT 1;

  IF v_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(
    (cm.muted_until IS NOT NULL AND cm.muted_until > now()),
    false
  ) INTO v_muted
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id AND cm.user_id = v_recipient;

  IF v_muted THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(p.name, 'Neighbour') INTO v_sender_name
  FROM public.profiles p WHERE p.id = NEW.sender_id;

  IF v_conv.status = 'pending' AND v_conv.created_by = NEW.sender_id THEN
    v_type := 'message_request';
    v_title := 'Message request';
    v_body := v_sender_name || ' wants to message you';
  ELSE
    v_type := 'conversation_message';
    v_title := 'New message';
    v_body := v_sender_name || ': ' || left(
      CASE WHEN char_length(trim(NEW.body)) > 0 THEN NEW.body ELSE 'Sent a photo' END,
      120
    );
  END IF;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, action_url, payload)
  VALUES (
    v_recipient,
    v_title,
    v_body,
    v_type,
    '/messages/' || NEW.conversation_id::text,
    '/messages/' || NEW.conversation_id::text,
    jsonb_build_object(
      'conversation_id', NEW.conversation_id,
      'message_id', NEW.id,
      'sender_id', NEW.sender_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_conversation_message ON public.conversation_messages;
CREATE TRIGGER trg_notify_conversation_message
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_message();

-- ---------------------------------------------------------------------------
-- 7. Grants + Realtime
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.conversations_open_or_request(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_respond_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_send_message(uuid, text, text, text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_delete_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_mark_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_inbox(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.conversations_block_user(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication skip: %', SQLERRM;
END $$;
