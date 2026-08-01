
-- 1. Review prompts table
CREATE TABLE IF NOT EXISTS public.review_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  seller_name text,
  prompt_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shown', 'completed', 'dismissed', 'expired')),
  nudge_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, buyer_id)
);

ALTER TABLE public.review_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view own review prompts"
  ON public.review_prompts FOR SELECT TO authenticated
  USING (buyer_id = auth.uid());

CREATE POLICY "Buyers can update own review prompts"
  ON public.review_prompts FOR UPDATE TO authenticated
  USING (buyer_id = auth.uid()) WITH CHECK (buyer_id = auth.uid());

CREATE INDEX idx_review_prompts_buyer_pending ON public.review_prompts(buyer_id, status) WHERE status = 'pending';

-- 2. Auto-create prompt on delivery (correct enum values)
CREATE OR REPLACE FUNCTION public.fn_create_review_prompt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seller_name text; _has_review boolean;
BEGIN
  IF NEW.status IN ('delivered', 'completed', 'buyer_received') AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT EXISTS(SELECT 1 FROM public.reviews WHERE order_id = NEW.id AND buyer_id = NEW.buyer_id) INTO _has_review;
    IF NOT _has_review THEN
      SELECT business_name INTO _seller_name FROM public.seller_profiles WHERE id = NEW.seller_id;
      INSERT INTO public.review_prompts (order_id, buyer_id, seller_id, seller_name, prompt_at)
      VALUES (NEW.id, NEW.buyer_id, NEW.seller_id, _seller_name, now() + interval '2 hours')
      ON CONFLICT (order_id, buyer_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_review_prompt ON public.orders;
CREATE TRIGGER trg_create_review_prompt AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION fn_create_review_prompt();

-- 3. Mark prompt completed when review is submitted
CREATE OR REPLACE FUNCTION public.fn_complete_review_prompt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.review_prompts SET status = 'completed', updated_at = now()
  WHERE order_id = NEW.order_id AND buyer_id = NEW.buyer_id AND status IN ('pending', 'shown');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complete_review_prompt ON public.reviews;
CREATE TRIGGER trg_complete_review_prompt AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION fn_complete_review_prompt();

-- 4. RPC for pending prompts
CREATE OR REPLACE FUNCTION public.get_pending_review_prompts()
RETURNS TABLE(id uuid, order_id uuid, seller_id uuid, seller_name text, prompt_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rp.id, rp.order_id, rp.seller_id, rp.seller_name, rp.prompt_at
  FROM public.review_prompts rp
  WHERE rp.buyer_id = auth.uid() AND rp.status = 'pending' AND rp.prompt_at <= now()
  ORDER BY rp.prompt_at ASC LIMIT 3;
$$;

-- 5. Nudge function
CREATE OR REPLACE FUNCTION public.fn_send_review_nudges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count integer := 0; _prompt record;
BEGIN
  FOR _prompt IN
    SELECT rp.id, rp.buyer_id, rp.seller_name, rp.order_id
    FROM public.review_prompts rp
    WHERE rp.status = 'pending' AND rp.nudge_sent = false
      AND rp.prompt_at < now() - interval '24 hours'
      AND rp.prompt_at > now() - interval '7 days'
    LIMIT 50
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, data)
    VALUES (_prompt.buyer_id, 'How was your order?',
      'Rate your experience with ' || COALESCE(_prompt.seller_name, 'the seller') || ' — your review helps the community!',
      'review_nudge', jsonb_build_object('order_id', _prompt.order_id, 'action', 'review'))
    ON CONFLICT DO NOTHING;
    UPDATE public.review_prompts SET nudge_sent = true, updated_at = now() WHERE id = _prompt.id;
    _count := _count + 1;
  END LOOP;
  UPDATE public.review_prompts SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND prompt_at < now() - interval '14 days';
  RETURN _count;
END;
$$;

-- 6. Seed for existing delivered orders
INSERT INTO public.review_prompts (order_id, buyer_id, seller_id, seller_name, prompt_at)
SELECT o.id, o.buyer_id, o.seller_id, sp.business_name, COALESCE(o.updated_at, o.created_at) + interval '2 hours'
FROM public.orders o
JOIN public.seller_profiles sp ON sp.id = o.seller_id
WHERE o.status IN ('delivered', 'completed', 'buyer_received')
  AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.order_id = o.id AND r.buyer_id = o.buyer_id)
ON CONFLICT (order_id, buyer_id) DO NOTHING;
