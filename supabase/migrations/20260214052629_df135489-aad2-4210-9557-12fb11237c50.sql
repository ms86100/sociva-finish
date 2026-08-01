
-- ============================================
-- QUICK HELP REQUESTS (SOS)
-- ============================================

CREATE TABLE public.help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  tag text NOT NULL DEFAULT 'question',
  status text NOT NULL DEFAULT 'open',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  response_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.help_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.help_requests(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_responses ENABLE ROW LEVEL SECURITY;

-- help_requests policies
CREATE POLICY "Users can view help requests in their society"
  ON public.help_requests FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Users can create help requests in their society"
  ON public.help_requests FOR INSERT
  WITH CHECK (author_id = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Authors can update their own help requests"
  ON public.help_requests FOR UPDATE
  USING (author_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Authors can delete their own help requests"
  ON public.help_requests FOR DELETE
  USING (author_id = auth.uid() OR is_admin(auth.uid()));

-- help_responses policies (private: only requester + responder can see)
CREATE POLICY "Requester and responder can view responses"
  ON public.help_responses FOR SELECT
  USING (
    responder_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.help_requests hr
      WHERE hr.id = help_responses.request_id AND hr.author_id = auth.uid()
    )
    OR is_admin(auth.uid())
  );

CREATE POLICY "Users can respond to help requests in their society"
  ON public.help_responses FOR INSERT
  WITH CHECK (
    responder_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.help_requests hr
      WHERE hr.id = help_responses.request_id
        AND hr.society_id = get_user_society_id(auth.uid())
        AND hr.status = 'open'
    )
  );

CREATE POLICY "Responders can delete their own responses"
  ON public.help_responses FOR DELETE
  USING (responder_id = auth.uid());

-- Trigger to update response_count
CREATE OR REPLACE FUNCTION public.update_help_response_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.help_requests SET response_count = response_count + 1 WHERE id = NEW.request_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.help_requests SET response_count = GREATEST(response_count - 1, 0) WHERE id = OLD.request_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER update_help_response_count_insert
  AFTER INSERT ON public.help_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_help_response_count();

CREATE TRIGGER update_help_response_count_delete
  AFTER DELETE ON public.help_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_help_response_count();

-- Indexes
CREATE INDEX idx_help_requests_society ON public.help_requests(society_id);
CREATE INDEX idx_help_requests_status ON public.help_requests(status);
CREATE INDEX idx_help_responses_request ON public.help_responses(request_id);

-- ============================================
-- RECURRING SUBSCRIPTIONS
-- ============================================

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'daily',
  quantity integer NOT NULL DEFAULT 1,
  delivery_days text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  next_delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  pause_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subscription_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id),
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view their own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (buyer_id = auth.uid() OR EXISTS (
    SELECT 1 FROM seller_profiles sp WHERE sp.id = subscriptions.seller_id AND sp.user_id = auth.uid()
  ) OR is_admin(auth.uid()));

CREATE POLICY "Buyers can create subscriptions"
  ON public.subscriptions FOR INSERT
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Buyers can update their own subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (buyer_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Buyers can view their subscription deliveries"
  ON public.subscription_deliveries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.id = subscription_deliveries.subscription_id
      AND (s.buyer_id = auth.uid() OR EXISTS (
        SELECT 1 FROM seller_profiles sp WHERE sp.id = s.seller_id AND sp.user_id = auth.uid()
      ))
  ) OR is_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Indexes
CREATE INDEX idx_subscriptions_buyer ON public.subscriptions(buyer_id);
CREATE INDEX idx_subscriptions_seller ON public.subscriptions(seller_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX idx_subscriptions_next_delivery ON public.subscriptions(next_delivery_date);
CREATE INDEX idx_subscription_deliveries_sub ON public.subscription_deliveries(subscription_id);

-- ============================================
-- COMMUNITY TRUST DIRECTORY
-- ============================================

CREATE TABLE public.skill_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  skill_name text NOT NULL,
  description text,
  availability text,
  trust_score numeric NOT NULL DEFAULT 0,
  endorsement_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.skill_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES public.skill_listings(id) ON DELETE CASCADE,
  endorser_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, endorser_id)
);

-- RLS
ALTER TABLE public.skill_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_endorsements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view skills in their society"
  ON public.skill_listings FOR SELECT
  USING (society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()));

CREATE POLICY "Users can add their own skills"
  ON public.skill_listings FOR INSERT
  WITH CHECK (user_id = auth.uid() AND society_id = get_user_society_id(auth.uid()));

CREATE POLICY "Users can update their own skills"
  ON public.skill_listings FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own skills"
  ON public.skill_listings FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can view endorsements in their society"
  ON public.skill_endorsements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM skill_listings sl WHERE sl.id = skill_endorsements.skill_id
      AND (sl.society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid()))
  ));

CREATE POLICY "Users can endorse skills"
  ON public.skill_endorsements FOR INSERT
  WITH CHECK (endorser_id = auth.uid() AND EXISTS (
    SELECT 1 FROM skill_listings sl WHERE sl.id = skill_endorsements.skill_id
      AND sl.society_id = get_user_society_id(auth.uid())
  ));

CREATE POLICY "Users can remove their endorsement"
  ON public.skill_endorsements FOR DELETE
  USING (endorser_id = auth.uid());

-- Trigger for endorsement count
CREATE OR REPLACE FUNCTION public.update_endorsement_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.skill_listings SET 
      endorsement_count = endorsement_count + 1,
      trust_score = endorsement_count + 1
    WHERE id = NEW.skill_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.skill_listings SET 
      endorsement_count = GREATEST(endorsement_count - 1, 0),
      trust_score = GREATEST(endorsement_count - 1, 0)
    WHERE id = OLD.skill_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER update_endorsement_count_insert
  AFTER INSERT ON public.skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.update_endorsement_count();

CREATE TRIGGER update_endorsement_count_delete
  AFTER DELETE ON public.skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.update_endorsement_count();

-- Indexes
CREATE INDEX idx_skill_listings_society ON public.skill_listings(society_id);
CREATE INDEX idx_skill_listings_user ON public.skill_listings(user_id);
CREATE INDEX idx_skill_endorsements_skill ON public.skill_endorsements(skill_id);
