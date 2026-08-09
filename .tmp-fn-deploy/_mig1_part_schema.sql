-- 1. Schema
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buyer_wallets (
  user_id uuid PRIMARY KEY,
  cash_available numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_available >= 0),
  promo_available numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_available >= 0),
  cash_pending numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_pending >= 0),
  promo_pending numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_pending >= 0),
  lifetime_credited numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_credited >= 0),
  lifetime_spent numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  lifetime_expired numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_expired >= 0),
  version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.buyer_wallets(user_id),
  bucket text NOT NULL CHECK (bucket IN ('cash', 'promo')),
  source text NOT NULL DEFAULT 'support'
    CHECK (source IN (
      'refund', 'promo_campaign', 'referral', 'support',
      'clawback_adjust', 'spend_restore', 'admin'
    )),
  original_amount numeric(12,2) NOT NULL CHECK (original_amount > 0),
  remaining_amount numeric(12,2) NOT NULL CHECK (remaining_amount >= 0),
  expires_at timestamptz,
  order_id uuid,
  refund_id uuid,
  campaign_id text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'depleted', 'expired', 'reversed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_lots_remaining_lte_original
    CHECK (remaining_amount <= original_amount)
);

CREATE INDEX IF NOT EXISTS idx_wallet_lots_user_fifo
  ON public.wallet_credit_lots (user_id, bucket, expires_at NULLS LAST, created_at)
  WHERE status = 'open' AND remaining_amount > 0;

CREATE INDEX IF NOT EXISTS idx_wallet_lots_refund
  ON public.wallet_credit_lots (refund_id)
  WHERE refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wallet_ledger_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN (
    'spend_reserve', 'spend_commit', 'spend_release',
    'refund_credit', 'promo_issue', 'promo_clawback',
    'expire', 'adjust', 'reverse', 'spend_restore'
  )),
  reference_type text,
  reference_id text,
  idempotency_key text,
  description text,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_txns_idempotency
  ON public.wallet_ledger_txns (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_txns_user_created
  ON public.wallet_ledger_txns (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL REFERENCES public.wallet_ledger_txns(id),
  account text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  bucket text CHECK (bucket IS NULL OR bucket IN ('cash', 'promo')),
  lot_id uuid REFERENCES public.wallet_credit_lots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_txn
  ON public.wallet_ledger_entries (txn_id);

CREATE TABLE IF NOT EXISTS public.wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.buyer_wallets(user_id),
  order_ids uuid[] NOT NULL DEFAULT '{}',
  cash_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  promo_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_amount >= 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'committed', 'released', 'expired')),
  idempotency_key text,
  checkout_key text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_reservations_positive
    CHECK (cash_amount + promo_amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_reservations_idempotency
  ON public.wallet_reservations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_reservations_user_status
  ON public.wallet_reservations (user_id, status);

-- Orders: wallet money fields
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wallet_cash_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_promo_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_reservation_id uuid;

-- Settlements: wallet applied audit
ALTER TABLE public.seller_settlements
  ADD COLUMN IF NOT EXISTS wallet_cash_applied numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_promo_applied numeric(12,2) NOT NULL DEFAULT 0;

-- Refunds: destination for Sociva Credit
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS refund_destination text NOT NULL DEFAULT 'original_payment'
    CHECK (refund_destination IN ('original_payment', 'wallet', 'split')),
  ADD COLUMN IF NOT EXISTS wallet_credit_amount numeric(12,2);

-- RLS
ALTER TABLE public.buyer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own buyer wallet" ON public.buyer_wallets;
CREATE POLICY "Users can view own buyer wallet"
  ON public.buyer_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all buyer wallets" ON public.buyer_wallets;
CREATE POLICY "Admins can view all buyer wallets"
  ON public.buyer_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet lots" ON public.wallet_credit_lots;
CREATE POLICY "Users can view own wallet lots"
  ON public.wallet_credit_lots FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallet lots" ON public.wallet_credit_lots;
CREATE POLICY "Admins can view all wallet lots"
  ON public.wallet_credit_lots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet txns" ON public.wallet_ledger_txns;
CREATE POLICY "Users can view own wallet txns"
  ON public.wallet_ledger_txns FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallet txns" ON public.wallet_ledger_txns;
CREATE POLICY "Admins can view all wallet txns"
  ON public.wallet_ledger_txns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet entries" ON public.wallet_ledger_entries;
CREATE POLICY "Users can view own wallet entries"
  ON public.wallet_ledger_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.wallet_ledger_txns t
      WHERE t.id = txn_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all wallet entries" ON public.wallet_ledger_entries;
CREATE POLICY "Admins can view all wallet entries"
  ON public.wallet_ledger_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet reservations" ON public.wallet_reservations;
CREATE POLICY "Users can view own wallet reservations"
  ON public.wallet_reservations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Immutable ledger: revoke UPDATE/DELETE from clients (service_role bypasses RLS)
REVOKE INSERT, UPDATE, DELETE ON public.buyer_wallets FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_credit_lots FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_txns FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_entries FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_reservations FROM authenticated, anon;

-- ------------------------------------------------------------
