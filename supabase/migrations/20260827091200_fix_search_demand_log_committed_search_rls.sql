-- log_committed_search uses INSERT ... ON CONFLICT (session_query_id).
-- Under RLS, ON CONFLICT requires the caller to SELECT candidate conflict rows.
-- Without a SELECT policy, authenticated inserts fail with:
--   "new row violates row-level security policy for table search_demand_log"
-- That only breaks telemetry; search results are set before this RPC.

DROP POLICY IF EXISTS "users_select_own_search_demand" ON public.search_demand_log;
CREATE POLICY "users_select_own_search_demand"
ON public.search_demand_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "auth_insert_search_demand" ON public.search_demand_log;
CREATE POLICY "auth_insert_search_demand"
ON public.search_demand_log
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Harden telemetry RPC: require a signed-in user; keep society attribution from profile only.
CREATE OR REPLACE FUNCTION public.log_committed_search(
  _session_query_id uuid,
  _search_term text,
  _society_id uuid DEFAULT NULL,
  _category text DEFAULT NULL,
  _result_count integer DEFAULT NULL,
  _filters jsonb DEFAULT '{}'::jsonb,
  _retrieval_mode text DEFAULT NULL,
  _latency_ms integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
  resolved_society_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF _session_query_id IS NULL OR length(btrim(COALESCE(_search_term, ''))) < 2 THEN
    RETURN false;
  END IF;

  -- Do not let clients attribute demand to a society they do not belong to.
  SELECT pr.society_id
  INTO resolved_society_id
  FROM public.profiles pr
  WHERE pr.id = v_uid;

  INSERT INTO public.search_demand_log (
    society_id,
    user_id,
    search_term,
    category,
    results_count,
    filters,
    retrieval_mode,
    latency_ms,
    session_query_id
  )
  VALUES (
    resolved_society_id,
    v_uid,
    lower(btrim(_search_term)),
    _category,
    GREATEST(COALESCE(_result_count, 0), 0),
    COALESCE(_filters, '{}'::jsonb),
    left(NULLIF(btrim(_retrieval_mode), ''), 40),
    LEAST(GREATEST(COALESCE(_latency_ms, 0), 0), 600000),
    _session_query_id
  )
  ON CONFLICT (session_query_id) WHERE session_query_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.log_committed_search(
  uuid, text, uuid, text, integer, jsonb, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_committed_search(
  uuid, text, uuid, text, integer, jsonb, text, integer
) TO authenticated;
