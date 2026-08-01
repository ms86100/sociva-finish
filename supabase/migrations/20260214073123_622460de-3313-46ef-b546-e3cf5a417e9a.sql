
-- 1. Notification Queue table
CREATE TABLE public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  reference_path text,
  payload jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

-- Service role processes queue; authenticated users can insert
CREATE POLICY "Authenticated users can enqueue notifications"
  ON public.notification_queue FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can view their own queued notifications"
  ON public.notification_queue FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin(auth.uid()));

CREATE INDEX idx_notification_queue_status ON public.notification_queue (status, created_at)
  WHERE status = 'pending';

-- 2. Orders Archive table (mirrors orders schema)
CREATE TABLE public.orders_archive (
  id uuid PRIMARY KEY,
  buyer_id uuid,
  seller_id uuid,
  society_id uuid,
  status text,
  total_amount numeric NOT NULL,
  payment_status text,
  payment_type text,
  order_type text,
  notes text,
  delivery_address text,
  rejection_reason text,
  discount_amount numeric DEFAULT 0,
  coupon_id uuid,
  deposit_paid boolean DEFAULT false,
  deposit_refunded boolean DEFAULT false,
  rental_start_date date,
  rental_end_date date,
  scheduled_date date,
  scheduled_time_start time,
  scheduled_time_end time,
  razorpay_order_id text,
  razorpay_payment_id text,
  auto_cancel_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view archived orders"
  ON public.orders_archive FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

CREATE INDEX idx_orders_archive_created ON public.orders_archive (created_at DESC);

-- 3. Audit Log Archive table (mirrors audit_log schema)
CREATE TABLE public.audit_log_archive (
  id uuid PRIMARY KEY,
  actor_id uuid,
  society_id uuid,
  target_type text NOT NULL,
  target_id uuid,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view archived audit logs"
  ON public.audit_log_archive FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

CREATE INDEX idx_audit_archive_created ON public.audit_log_archive (created_at DESC);

-- 4. Rate Limits table
CREATE TABLE public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies needed; only service role accesses this table

-- 5. Idempotency key on orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON public.orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 6. Idempotency key on payment_records
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_idempotency_key ON public.payment_records (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 7. Society scoping for featured_items
ALTER TABLE public.featured_items ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id);
CREATE INDEX IF NOT EXISTS idx_featured_items_society ON public.featured_items (society_id) WHERE society_id IS NOT NULL;

-- Update featured_items SELECT policy to be society-aware
DROP POLICY IF EXISTS "Anyone can view active featured items" ON public.featured_items;
CREATE POLICY "Anyone can view active featured items in their society"
  ON public.featured_items FOR SELECT TO authenticated
  USING (
    (is_active = true AND (society_id IS NULL OR society_id = get_user_society_id(auth.uid())))
    OR is_admin(auth.uid())
  );
