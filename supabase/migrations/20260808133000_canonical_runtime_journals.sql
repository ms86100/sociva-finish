-- Canonical runtime journal wiring. Read projections remain disabled.
BEGIN;

CREATE OR REPLACE FUNCTION finance.post_settlement_financial_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_commission_minor bigint;
  v_wallet_minor bigint;
  v_net_minor bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_commission_minor := round(COALESCE(NEW.platform_fee, 0) * 100)::bigint;
    v_wallet_minor := round((
      COALESCE(NEW.wallet_cash_applied, 0)
      + COALESCE(NEW.wallet_promo_applied, 0)
      + COALESCE(NEW.platform_loyalty_subsidy, 0)
    ) * 100)::bigint;
    IF v_wallet_minor > 0 THEN
      PERFORM finance.post_journal(
        'PAYMENT_ALLOCATED', 'settlement_wallet_allocation', NEW.id::text,
        'settlement-wallet-allocation:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'financial_suspense', 'direction', 'debit',
            'amount_minor', v_wallet_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id
          ),
          jsonb_build_object(
            'account_code', 'seller_payable_pending', 'direction', 'credit',
            'amount_minor', v_wallet_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id,
            'metadata', jsonb_build_object('seller_id', NEW.seller_id)
          )
        ),
        'Wallet and platform-funded value allocated to seller payable',
        jsonb_build_object('seller_id', NEW.seller_id),
        NEW.created_at, NULL
      );
    END IF;
    IF v_commission_minor > 0 THEN
      PERFORM finance.post_journal(
        'PLATFORM_COMMISSION', 'seller_settlement', NEW.id::text,
        'settlement-commission:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'seller_payable_pending', 'direction', 'debit',
            'amount_minor', v_commission_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id,
            'metadata', jsonb_build_object('seller_id', NEW.seller_id)
          ),
          jsonb_build_object(
            'account_code', 'platform_commission_revenue', 'direction', 'credit',
            'amount_minor', v_commission_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id
          )
        ),
        'Platform commission recognized from seller payable',
        jsonb_build_object('seller_id', NEW.seller_id),
        NEW.created_at, NULL
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.settlement_status IS DISTINCT FROM NEW.settlement_status
     AND NEW.settlement_status = 'eligible' THEN
    v_net_minor := round(COALESCE(NEW.net_amount, 0) * 100)::bigint;
    IF v_net_minor > 0 THEN
      PERFORM finance.post_journal(
        'SELLER_EARNING_ELIGIBLE', 'seller_settlement', NEW.id::text,
        'settlement-eligible:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'seller_payable_pending', 'direction', 'debit',
            'amount_minor', v_net_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id,
            'metadata', jsonb_build_object('seller_id', NEW.seller_id)
          ),
          jsonb_build_object(
            'account_code', 'seller_payable_available', 'direction', 'credit',
            'amount_minor', v_net_minor, 'order_id', NEW.order_id,
            'settlement_id', NEW.id,
            'metadata', jsonb_build_object('seller_id', NEW.seller_id)
          )
        ),
        'Seller earning passed fulfillment and reconciliation gates',
        jsonb_build_object('seller_id', NEW.seller_id),
        now(), NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_settlement_financial_events
  ON public.seller_settlements;
CREATE TRIGGER trg_post_settlement_financial_events
AFTER INSERT OR UPDATE OF settlement_status ON public.seller_settlements
FOR EACH ROW EXECUTE FUNCTION finance.post_settlement_financial_events();

CREATE OR REPLACE FUNCTION finance.post_buyer_credit_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_amount_minor bigint;
  v_debit_account text;
  v_original_transaction_id uuid;
BEGIN
  IF NEW.source = 'spend_restore' THEN
    SELECT id INTO v_original_transaction_id
    FROM finance.ledger_transactions
    WHERE event_type = 'BUYER_CREDIT_SPENT'
      AND metadata->'order_ids' @> jsonb_build_array(NEW.order_id)
      AND posted_at IS NOT NULL
    ORDER BY posted_at DESC
    LIMIT 1;
    IF v_original_transaction_id IS NULL THEN
      RAISE EXCEPTION 'wallet restore requires original spend journal';
    END IF;
    PERFORM finance.reverse_posted_journal(
      v_original_transaction_id,
      'buyer-credit-spend-reversal:' || NEW.order_id::text,
      'Exact reversal of restored SOCIVA Credit spend'
    );
    RETURN NEW;
  END IF;
  v_amount_minor := round(COALESCE(NEW.original_amount, 0) * 100)::bigint;
  IF v_amount_minor <= 0 THEN
    RETURN NEW;
  END IF;
  v_debit_account := CASE
    WHEN NEW.source = 'refund' THEN 'refund_payable'
    ELSE 'promotion_expense'
  END;
  PERFORM finance.post_journal(
    'BUYER_CREDIT_ISSUED', 'wallet_credit_lot', NEW.id::text,
    'buyer-credit-issued:' || NEW.id::text,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', v_debit_account, 'direction', 'debit',
        'amount_minor', v_amount_minor,
        'metadata', jsonb_build_object('user_id', NEW.user_id, 'bucket', NEW.bucket)
      ),
      jsonb_build_object(
        'account_code', 'buyer_credit_liability', 'direction', 'credit',
        'amount_minor', v_amount_minor,
        'metadata', jsonb_build_object('user_id', NEW.user_id, 'bucket', NEW.bucket)
      )
    ),
    'Non-loadable SOCIVA Credit issued',
    jsonb_build_object('user_id', NEW.user_id, 'source', NEW.source),
    NEW.created_at, NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_buyer_credit_issue
  ON public.wallet_credit_lots;
CREATE TRIGGER trg_post_buyer_credit_issue
AFTER INSERT ON public.wallet_credit_lots
FOR EACH ROW EXECUTE FUNCTION finance.post_buyer_credit_issue();

CREATE OR REPLACE FUNCTION finance.post_buyer_credit_spend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_amount_minor bigint;
BEGIN
  IF NEW.status <> 'committed' OR OLD.status = 'committed' THEN
    RETURN NEW;
  END IF;
  v_amount_minor := round((
    COALESCE(NEW.cash_amount, 0) + COALESCE(NEW.promo_amount, 0)
  ) * 100)::bigint;
  IF v_amount_minor <= 0 THEN
    RETURN NEW;
  END IF;
  PERFORM finance.post_journal(
    'BUYER_CREDIT_SPENT', 'wallet_reservation', NEW.id::text,
    'buyer-credit-spent:' || NEW.id::text,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', 'buyer_credit_liability', 'direction', 'debit',
        'amount_minor', v_amount_minor,
        'metadata', jsonb_build_object('user_id', NEW.user_id)
      ),
      jsonb_build_object(
        'account_code', 'financial_suspense', 'direction', 'credit',
        'amount_minor', v_amount_minor,
        'metadata', jsonb_build_object(
          'user_id', NEW.user_id, 'order_ids', NEW.order_ids
        )
      )
    ),
    'SOCIVA Credit committed to checkout orders',
    jsonb_build_object('user_id', NEW.user_id, 'order_ids', NEW.order_ids),
    now(), NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_buyer_credit_spend
  ON public.wallet_reservations;
CREATE TRIGGER trg_post_buyer_credit_spend
AFTER UPDATE OF status ON public.wallet_reservations
FOR EACH ROW EXECUTE FUNCTION finance.post_buyer_credit_spend();

CREATE OR REPLACE FUNCTION finance.post_cod_financial_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_amount_minor bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_amount_minor := NEW.expected_amount_minor;
    IF v_amount_minor > 0 THEN
      PERFORM finance.post_journal(
        'COD_EXPECTED', 'cod_transaction', NEW.id::text,
        'cod-expected:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'cod_receivable', 'direction', 'debit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
            'metadata', jsonb_build_object(
              'seller_id', NEW.seller_id, 'collector_type', NEW.collector_type
            )
          ),
          jsonb_build_object(
            'account_code', 'financial_suspense', 'direction', 'credit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id
          )
        ),
        'COD expected from configured collector',
        jsonb_build_object('collector_type', NEW.collector_type),
        NEW.created_at, NULL
      );
    END IF;
  ELSIF NEW.status IN ('confirmed', 'reconciled')
     AND OLD.status NOT IN ('confirmed', 'reconciled') THEN
    v_amount_minor := COALESCE(NEW.collected_amount_minor, 0);
    IF v_amount_minor > 0 THEN
      PERFORM finance.post_journal(
        'COD_COLLECTED', 'cod_transaction', NEW.id::text,
        'cod-collected:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'financial_suspense', 'direction', 'debit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id
          ),
          jsonb_build_object(
            'account_code', 'cod_receivable', 'direction', 'credit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
            'metadata', jsonb_build_object(
              'seller_id', NEW.seller_id, 'collector_type', NEW.collector_type
            )
          )
        ),
        'COD collection confirmed; no online seller payable created',
        jsonb_build_object('collector_type', NEW.collector_type),
        COALESCE(NEW.confirmed_at, now()), NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_cod_financial_event
  ON public.cod_transactions;
CREATE TRIGGER trg_post_cod_financial_event
AFTER INSERT OR UPDATE OF status ON public.cod_transactions
FOR EACH ROW EXECUTE FUNCTION finance.post_cod_financial_event();

COMMIT;
