-- Staging: MyGate-style tower/unit registry, chat_messages society context,
-- deeper storage isolation. Architecture skill: VOLATILE+RL on DEFINER RPCs,
-- no RLS weakening, society-scoped keys, staging-only apply.

-- =============================================================================
-- 1) Tower / unit master registry
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.society_towers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_towers_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT society_towers_society_name_key UNIQUE (society_id, name)
);

CREATE TABLE IF NOT EXISTS public.society_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  tower_id uuid NOT NULL REFERENCES public.society_towers(id) ON DELETE CASCADE,
  floor text,
  unit_number text NOT NULL,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_units_unit_nonempty CHECK (length(trim(unit_number)) > 0),
  CONSTRAINT society_units_tower_unit_key UNIQUE (tower_id, unit_number)
);

CREATE INDEX IF NOT EXISTS idx_society_towers_society_id ON public.society_towers(society_id);
CREATE INDEX IF NOT EXISTS idx_society_units_society_id ON public.society_units(society_id);
CREATE INDEX IF NOT EXISTS idx_society_units_tower_id ON public.society_units(tower_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tower_id uuid REFERENCES public.society_towers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.society_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_tower_id ON public.profiles(tower_id) WHERE tower_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_unit_id ON public.profiles(unit_id) WHERE unit_id IS NOT NULL;

ALTER TABLE public.society_towers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS society_towers_select ON public.society_towers;
CREATE POLICY society_towers_select ON public.society_towers
FOR SELECT TO authenticated
USING (
  public.is_admin((SELECT auth.uid()))
  OR society_id = public.get_user_society_id((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
);

DROP POLICY IF EXISTS society_towers_write_admin ON public.society_towers;
CREATE POLICY society_towers_write_admin ON public.society_towers
FOR ALL TO authenticated
USING (
  public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
)
WITH CHECK (
  public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
);

DROP POLICY IF EXISTS society_units_select ON public.society_units;
CREATE POLICY society_units_select ON public.society_units
FOR SELECT TO authenticated
USING (
  public.is_admin((SELECT auth.uid()))
  OR society_id = public.get_user_society_id((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
);

DROP POLICY IF EXISTS society_units_write_admin ON public.society_units;
CREATE POLICY society_units_write_admin ON public.society_units
FOR ALL TO authenticated
USING (
  public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
)
WITH CHECK (
  public.is_admin((SELECT auth.uid()))
  OR public.is_society_admin((SELECT auth.uid()), society_id)
);

-- List towers (rate-limited DEFINER)
CREATE OR REPLACE FUNCTION public.list_society_towers(_society_id uuid)
RETURNS TABLE (
  id uuid,
  society_id uuid,
  name text,
  sort_order integer,
  is_active boolean,
  unit_count bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM public.sociva_assert_rate_limit(
    'list_society_towers:' || auth.uid()::text,
    60,
    60
  );
  IF NOT (
    public.is_admin(auth.uid())
    OR _society_id = public.get_user_society_id(auth.uid())
    OR public.is_society_admin(auth.uid(), _society_id)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.society_id,
    t.name,
    t.sort_order,
    t.is_active,
    (SELECT count(*) FROM public.society_units u WHERE u.tower_id = t.id AND u.is_active)
  FROM public.society_towers t
  WHERE t.society_id = _society_id
    AND t.is_active
  ORDER BY t.sort_order, t.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_society_units(_society_id uuid, _tower_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  society_id uuid,
  tower_id uuid,
  tower_name text,
  floor text,
  unit_number text,
  label text,
  is_active boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM public.sociva_assert_rate_limit(
    'list_society_units:' || auth.uid()::text,
    60,
    60
  );
  IF NOT (
    public.is_admin(auth.uid())
    OR _society_id = public.get_user_society_id(auth.uid())
    OR public.is_society_admin(auth.uid(), _society_id)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.society_id,
    u.tower_id,
    t.name,
    u.floor,
    u.unit_number,
    u.label,
    u.is_active
  FROM public.society_units u
  JOIN public.society_towers t ON t.id = u.tower_id
  WHERE u.society_id = _society_id
    AND u.is_active
    AND (_tower_id IS NULL OR u.tower_id = _tower_id)
  ORDER BY t.sort_order, t.name, u.floor NULLS LAST, u.unit_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_society_tower(
  _society_id uuid,
  _name text,
  _sort_order integer DEFAULT 0,
  _tower_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text := trim(coalesce(_name, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_admin(v_uid) OR public.is_society_admin(v_uid, _society_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  PERFORM public.sociva_assert_rate_limit('admin_upsert_tower:' || v_uid::text, 40, 60);
  IF v_name = '' THEN RAISE EXCEPTION 'tower name required'; END IF;

  IF _tower_id IS NULL THEN
    INSERT INTO public.society_towers (society_id, name, sort_order)
    VALUES (_society_id, v_name, coalesce(_sort_order, 0))
    ON CONFLICT (society_id, name) DO UPDATE
      SET sort_order = EXCLUDED.sort_order,
          is_active = true,
          updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.society_towers
    SET name = v_name,
        sort_order = coalesce(_sort_order, sort_order),
        updated_at = now(),
        is_active = true
    WHERE id = _tower_id AND society_id = _society_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'tower not found'; END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_society_unit(
  _society_id uuid,
  _tower_id uuid,
  _unit_number text,
  _floor text DEFAULT NULL,
  _label text DEFAULT NULL,
  _unit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_unit text := trim(coalesce(_unit_number, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_admin(v_uid) OR public.is_society_admin(v_uid, _society_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  PERFORM public.sociva_assert_rate_limit('admin_upsert_unit:' || v_uid::text, 60, 60);
  IF v_unit = '' THEN RAISE EXCEPTION 'unit number required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.society_towers t
    WHERE t.id = _tower_id AND t.society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'tower not in society';
  END IF;

  IF _unit_id IS NULL THEN
    INSERT INTO public.society_units (society_id, tower_id, unit_number, floor, label)
    VALUES (_society_id, _tower_id, v_unit, nullif(trim(coalesce(_floor, '')), ''), nullif(trim(coalesce(_label, '')), ''))
    ON CONFLICT (tower_id, unit_number) DO UPDATE
      SET floor = EXCLUDED.floor,
          label = EXCLUDED.label,
          is_active = true,
          updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.society_units
    SET unit_number = v_unit,
        floor = nullif(trim(coalesce(_floor, '')), ''),
        label = nullif(trim(coalesce(_label, '')), ''),
        updated_at = now(),
        is_active = true
    WHERE id = _unit_id AND society_id = _society_id AND tower_id = _tower_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'unit not found'; END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_seed_tower_units(
  _society_id uuid,
  _tower_id uuid,
  _floors integer,
  _units_per_floor integer,
  _unit_prefix text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f int;
  v_u int;
  v_created int := 0;
  v_prefix text := coalesce(_unit_prefix, '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_admin(v_uid) OR public.is_society_admin(v_uid, _society_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  PERFORM public.sociva_assert_rate_limit('admin_seed_units:' || v_uid::text, 10, 60);
  IF _floors IS NULL OR _floors < 1 OR _floors > 80 THEN
    RAISE EXCEPTION 'floors must be 1-80';
  END IF;
  IF _units_per_floor IS NULL OR _units_per_floor < 1 OR _units_per_floor > 40 THEN
    RAISE EXCEPTION 'units per floor must be 1-40';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.society_towers t
    WHERE t.id = _tower_id AND t.society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'tower not in society';
  END IF;

  FOR v_f IN 1.._floors LOOP
    FOR v_u IN 1.._units_per_floor LOOP
      INSERT INTO public.society_units (society_id, tower_id, floor, unit_number)
      VALUES (
        _society_id,
        _tower_id,
        v_f::text,
        v_prefix || v_f::text || lpad(v_u::text, 2, '0')
      )
      ON CONFLICT (tower_id, unit_number) DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_resident_unit(
  _tower_id uuid,
  _unit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_tower_name text;
  v_unit_number text;
  v_floor text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.sociva_assert_rate_limit('set_resident_unit:' || v_uid::text, 20, 60);

  SELECT t.society_id, t.name, u.unit_number, u.floor
  INTO v_society, v_tower_name, v_unit_number, v_floor
  FROM public.society_units u
  JOIN public.society_towers t ON t.id = u.tower_id
  WHERE u.id = _unit_id
    AND u.tower_id = _tower_id
    AND u.is_active
    AND t.is_active;

  IF v_society IS NULL THEN RAISE EXCEPTION 'unit not found'; END IF;

  IF NOT (
    public.is_admin(v_uid)
    OR v_society = public.get_user_society_id(v_uid)
    OR EXISTS (
      SELECT 1 FROM public.society_memberships m
      WHERE m.user_id = v_uid AND m.society_id = v_society
        AND m.status IN ('pending', 'active')
    )
  ) THEN
    RAISE EXCEPTION 'not authorized for society';
  END IF;

  UPDATE public.profiles
  SET tower_id = _tower_id,
      unit_id = _unit_id,
      block = v_tower_name,
      flat_number = v_unit_number
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'tower_id', _tower_id,
    'unit_id', _unit_id,
    'block', v_tower_name,
    'flat_number', v_unit_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_society_towers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_society_units(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_society_tower(uuid, text, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_society_unit(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_seed_tower_units(uuid, uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_resident_unit(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_society_towers(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_society_units(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_society_tower(uuid, text, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_society_unit(uuid, uuid, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_seed_tower_units(uuid, uuid, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_resident_unit(uuid, uuid) TO authenticated, service_role;

-- Seed Stage2 A + Lakeview sample registry
INSERT INTO public.society_towers (society_id, name, sort_order)
VALUES
  ('a1111111-0001-4000-8000-00000000000a', 'Tower A', 1),
  ('a1111111-0001-4000-8000-00000000000a', 'Tower B', 2),
  ('a1111111-0002-4000-8000-00000000000b', 'Tower X', 1),
  ('94a7124c-a692-4d66-981f-0227b1317199', 'Tower H', 1),
  ('94a7124c-a692-4d66-981f-0227b1317199', 'Tower G', 2)
ON CONFLICT (society_id, name) DO NOTHING;

INSERT INTO public.society_units (society_id, tower_id, floor, unit_number)
SELECT t.society_id, t.id, f::text, f::text || lpad(u::text, 2, '0')
FROM public.society_towers t
CROSS JOIN generate_series(1, 3) f
CROSS JOIN generate_series(1, 4) u
WHERE t.society_id IN (
  'a1111111-0001-4000-8000-00000000000a',
  'a1111111-0002-4000-8000-00000000000b',
  '94a7124c-a692-4d66-981f-0227b1317199'
)
ON CONFLICT (tower_id, unit_number) DO NOTHING;

-- =============================================================================
-- 2) Legacy chat_messages society context (commerce-safe)
-- =============================================================================
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_society_id
  ON public.chat_messages(society_id)
  WHERE society_id IS NOT NULL;

-- Backfill from order buyer society (ops context); cross-society order chat still allowed via participants
UPDATE public.chat_messages cm
SET society_id = coalesce(o.buyer_society_id, o.society_id, o.seller_society_id)
FROM public.orders o
WHERE cm.order_id = o.id
  AND cm.society_id IS NULL
  AND coalesce(o.buyer_society_id, o.society_id, o.seller_society_id) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chat_messages_set_society_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sid uuid;
BEGIN
  IF NEW.society_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT coalesce(o.buyer_society_id, o.society_id, o.seller_society_id)
    INTO v_sid
    FROM public.orders o
    WHERE o.id = NEW.order_id;
    NEW.society_id := v_sid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_set_society ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_set_society
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.chat_messages_set_society_id();

DROP POLICY IF EXISTS "Users can view their own chat messages" ON public.chat_messages;
CREATE POLICY "Users can view their own chat messages"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR receiver_id = (SELECT auth.uid())
  OR public.is_admin((SELECT auth.uid()))
  OR (
    society_id IS NOT NULL
    AND public.is_society_admin((SELECT auth.uid()), society_id)
  )
);

DROP POLICY IF EXISTS "Users can send chat messages" ON public.chat_messages;
CREATE POLICY "Users can send chat messages"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND (
    order_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
      WHERE o.id = order_id
        AND (
          o.buyer_id = (SELECT auth.uid())
          OR sp.user_id = (SELECT auth.uid())
        )
    )
  )
);

-- =============================================================================
-- 3) Deeper storage isolation (private buckets: own folder only on INSERT)
-- =============================================================================
-- payment-proofs INSERT already folder-bound in some envs; harden support-evidence + vehicle-documents + app-images

DROP POLICY IF EXISTS "Buyers can upload evidence" ON storage.objects;
CREATE POLICY "Buyers can upload evidence"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'support-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
CREATE POLICY "Authenticated users can upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'app-images'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS vehicle_documents_storage_insert ON storage.objects;
CREATE POLICY vehicle_documents_storage_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;
CREATE POLICY "Users can upload payment proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
