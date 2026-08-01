DO $$
DECLARE
  v_user uuid := 'b3220352-30c5-4d23-98b1-f0911074f444';
  r record;
BEGIN
  -- Delete every row in any public table that has an FK pointing at this user (profiles.id or auth.users.id)
  FOR r IN
    SELECT n.nspname AS sch, c.conrelid::regclass::text AS tbl_full, t.relname AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f'
      AND n.nspname='public'
      AND (confrelid::regclass::text IN ('profiles','public.profiles','auth.users'))
      AND t.relname <> 'profiles'
      AND t.relname <> 'seller_profiles'
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.tbl, r.col) USING v_user;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip %.%: %', r.tbl, r.col, SQLERRM;
    END;
  END LOOP;

  -- Now seller_profiles and profiles
  DELETE FROM public.seller_profiles WHERE user_id = v_user;
  DELETE FROM public.profiles WHERE id = v_user;

  -- Auth cleanup
  DELETE FROM auth.identities WHERE user_id = v_user;
  DELETE FROM auth.sessions   WHERE user_id = v_user;
  DELETE FROM auth.mfa_factors WHERE user_id = v_user;
  DELETE FROM auth.one_time_tokens WHERE user_id = v_user;
  DELETE FROM auth.users WHERE id = v_user;
END $$;