-- Fix: loyalty_ledger / wallet_ledger_txns have PARTIAL unique indexes
--   UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL
-- but commit/release/expire used bare ON CONFLICT (idempotency_key),
-- which Postgres rejects with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- That breaks COD/wallet checkout when loyalty or Sociva Credit is applied
-- (apply_*_to_checkout_orders → commit_*_reservation).

DO $$
DECLARE
  r record;
  src text;
  new_src text;
  patched int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'commit_loyalty_reservation',
        'release_loyalty_reservation',
        'commit_wallet_reservation',
        'release_wallet_reservation',
        'expire_wallet_lots'
      )
    ORDER BY p.proname
  LOOP
    src := pg_get_functiondef(r.oid);
    new_src := replace(
      src,
      'ON CONFLICT (idempotency_key) DO',
      'ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO'
    );
    IF new_src IS DISTINCT FROM src THEN
      EXECUTE new_src;
      patched := patched + 1;
      RAISE NOTICE 'patched %', r.proname;
    ELSE
      RAISE NOTICE 'no bare ON CONFLICT in % (already fixed)', r.proname;
    END IF;
  END LOOP;

  -- Idempotent: already-patched DBs may have patched=0; that is OK.
  RAISE NOTICE 'patched_count=%', patched;
END $$;
