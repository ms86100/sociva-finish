BEGIN;

-- Canonical journals are service-owned. ACL revocation is the primary boundary;
-- RLS provides a second fail-closed boundary if a table grant regresses later.
ALTER TABLE finance.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ledger_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  finance.ledger_transactions,
  finance.ledger_entries
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  finance.ledger_transactions,
  finance.ledger_entries
TO service_role;

COMMIT;
