-- =============================================
-- MISSING FUNCTIONS
-- =============================================

CREATE OR REPLACE FUNCTION public.notify_waitlist_on_slot_release() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _waitlisted record;
  _product_name text;
BEGIN
  IF NEW.booked_count < OLD.booked_count AND NEW.booked_count < NEW.max_capacity THEN
    SELECT * INTO _waitlisted FROM public.slot_waitlist
    WHERE slot_id = NEW.id AND notified_at IS NULL
    ORDER BY created_at LIMIT 1;
    
    IF _waitlisted IS NOT NULL THEN
      SELECT name INTO _product_name FROM public.products WHERE id = _waitlisted.product_id;
      
      INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
      VALUES (
        _waitlisted.buyer_id,
        'order',
        '🎉 Slot Available!',
        COALESCE(_product_name, 'A service') || ' slot on ' || NEW.slot_date || ' at ' || LEFT(NEW.start_time::text, 5) || ' is now available. Book now!',
        '/marketplace',
        jsonb_build_object('type', 'waitlist', 'slotId', NEW.id::text, 'productId', _waitlisted.product_id::text)
      );
      
      UPDATE public.slot_waitlist SET notified_at = now() WHERE id = _waitlisted.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_recompute_seller_stats() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled', 'delivered') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.recompute_seller_stats(NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.seller_conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_product_seller_category() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  _seller_categories text[];
BEGIN
  SELECT categories INTO _seller_categories
  FROM public.seller_profiles WHERE id = NEW.seller_id;

  IF _seller_categories IS NULL OR array_length(_seller_categories, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (NEW.category = ANY(_seller_categories)) THEN
    RAISE EXCEPTION 'Product category "%" is not in seller''s allowed categories', NEW.category;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_product_store_action_type() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  _store_default text;
  _store_checkout_mode text;
  _product_checkout_mode text;
BEGIN
  SELECT default_action_type INTO _store_default
  FROM public.seller_profiles WHERE id = NEW.seller_id;

  IF _store_default IS NULL THEN RETURN NEW; END IF;

  SELECT checkout_mode INTO _store_checkout_mode
  FROM public.action_type_workflow_map WHERE action_type = _store_default;

  SELECT checkout_mode INTO _product_checkout_mode
  FROM public.action_type_workflow_map WHERE action_type = NEW.action_type;

  IF _store_checkout_mode IS DISTINCT FROM _product_checkout_mode THEN
    RAISE EXCEPTION 'Product action_type "%" conflicts with store default "%". Checkout modes must match.',
      NEW.action_type, _store_default;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_session_feedback_rating() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_cart_item_store_availability() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_seller_id uuid;
  v_status jsonb;
  v_status_text text;
begin
  select p.seller_id
    into v_seller_id
  from public.products p
  where p.id = new.product_id
    and p.is_available = true
    and p.approval_status = 'approved';

  if v_seller_id is null then
    raise exception 'PRODUCT_NOT_ORDERABLE' using errcode = 'P0001';
  end if;

  select public.compute_store_status(
    sp.availability_start,
    sp.availability_end,
    sp.operating_days,
    coalesce(sp.is_available, true)
  )
  into v_status
  from public.seller_profiles sp
  where sp.id = v_seller_id;

  if v_status is null then
    raise exception 'SELLER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_status_text := coalesce(v_status->>'status', 'closed');
  if v_status_text <> 'open' then
    raise exception 'STORE_CLOSED:%', v_status_text using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- =============================================
-- MISSING TRIGGERS
-- =============================================

-- Drop duplicates if they exist, then create
DO $$ BEGIN
  -- check_seller_license_trigger (duplicate name variant)
  DROP TRIGGER IF EXISTS check_seller_license_trigger ON public.products;
  CREATE TRIGGER check_seller_license_trigger BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.check_seller_license();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS set_service_bookings_updated_at ON public.service_bookings;
  CREATE TRIGGER set_service_bookings_updated_at BEFORE UPDATE ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS set_service_listings_updated_at ON public.service_listings;
  CREATE TRIGGER set_service_listings_updated_at BEFORE UPDATE ON public.service_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_enqueue_order_notification_insert ON public.orders;
  CREATE TRIGGER trg_enqueue_order_notification_insert AFTER INSERT ON public.orders FOR EACH ROW WHEN ((new.status = ANY (ARRAY['placed'::public.order_status, 'enquired'::public.order_status]))) EXECUTE FUNCTION public.fn_enqueue_order_status_notification();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_enqueue_order_status_notification ON public.orders;
  CREATE TRIGGER trg_enqueue_order_status_notification AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.fn_enqueue_order_status_notification();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_log_bulletin_activity ON public.bulletin_posts;
  CREATE TRIGGER trg_log_bulletin_activity AFTER INSERT ON public.bulletin_posts FOR EACH ROW EXECUTE FUNCTION public.log_bulletin_activity();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_log_dispute_activity ON public.dispute_tickets;
  CREATE TRIGGER trg_log_dispute_activity AFTER INSERT ON public.dispute_tickets FOR EACH ROW EXECUTE FUNCTION public.log_dispute_activity();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_log_help_request_activity ON public.help_requests;
  CREATE TRIGGER trg_log_help_request_activity AFTER INSERT ON public.help_requests FOR EACH ROW EXECUTE FUNCTION public.log_help_request_activity();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_log_order_activity ON public.orders;
  CREATE TRIGGER trg_log_order_activity AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_activity();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_notify_favorited_seller_new_product ON public.products;
  CREATE TRIGGER trg_notify_favorited_seller_new_product AFTER INSERT ON public.products FOR EACH ROW WHEN (((new.is_available = true) AND (new.approval_status = 'approved'::text))) EXECUTE FUNCTION public.notify_favorited_seller_new_product();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_notify_waitlist_on_slot_release ON public.service_slots;
  CREATE TRIGGER trg_notify_waitlist_on_slot_release AFTER UPDATE OF booked_count ON public.service_slots FOR EACH ROW EXECUTE FUNCTION public.notify_waitlist_on_slot_release();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_recompute_seller_stats ON public.orders;
  CREATE TRIGGER trg_recompute_seller_stats AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.trigger_recompute_seller_stats();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_update_bulletin_comment_count ON public.bulletin_comments;
  CREATE TRIGGER trg_update_bulletin_comment_count AFTER INSERT OR DELETE ON public.bulletin_comments FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_comment_count();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_update_bulletin_vote_count ON public.bulletin_votes;
  CREATE TRIGGER trg_update_bulletin_vote_count AFTER INSERT OR DELETE ON public.bulletin_votes FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_vote_count();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_update_conversation_last_message ON public.seller_conversation_messages;
  CREATE TRIGGER trg_update_conversation_last_message AFTER INSERT ON public.seller_conversation_messages FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_update_help_response_count ON public.help_responses;
  CREATE TRIGGER trg_update_help_response_count AFTER INSERT OR DELETE ON public.help_responses FOR EACH ROW EXECUTE FUNCTION public.update_help_response_count();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_update_seller_rating ON public.reviews;
  CREATE TRIGGER trg_update_seller_rating AFTER INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_seller_rating();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- updated_at triggers
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_admin_settings ON public.admin_settings; CREATE TRIGGER trg_update_updated_at_admin_settings BEFORE UPDATE ON public.admin_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_builders ON public.builders; CREATE TRIGGER trg_update_updated_at_builders BEFORE UPDATE ON public.builders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_bulletin_posts ON public.bulletin_posts; CREATE TRIGGER trg_update_updated_at_bulletin_posts BEFORE UPDATE ON public.bulletin_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_category_config ON public.category_config; CREATE TRIGGER trg_update_updated_at_category_config BEFORE UPDATE ON public.category_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_coupons ON public.coupons; CREATE TRIGGER trg_update_updated_at_coupons BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_delivery_assignments ON public.delivery_assignments; CREATE TRIGGER trg_update_updated_at_delivery_assignments BEFORE UPDATE ON public.delivery_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_delivery_partners ON public.delivery_partners; CREATE TRIGGER trg_update_updated_at_delivery_partners BEFORE UPDATE ON public.delivery_partners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_domestic_help_entries ON public.domestic_help_entries; CREATE TRIGGER trg_update_updated_at_domestic_help_entries BEFORE UPDATE ON public.domestic_help_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_feature_packages ON public.feature_packages; CREATE TRIGGER trg_update_updated_at_feature_packages BEFORE UPDATE ON public.feature_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_featured_items ON public.featured_items; CREATE TRIGGER trg_update_updated_at_featured_items BEFORE UPDATE ON public.featured_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_inspection_checklists ON public.inspection_checklists; CREATE TRIGGER trg_update_updated_at_inspection_checklists BEFORE UPDATE ON public.inspection_checklists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_inspection_items ON public.inspection_items; CREATE TRIGGER trg_update_updated_at_inspection_items BEFORE UPDATE ON public.inspection_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_orders ON public.orders; CREATE TRIGGER trg_update_updated_at_orders BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_products ON public.products; CREATE TRIGGER trg_update_updated_at_products BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_profiles ON public.profiles; CREATE TRIGGER trg_update_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_seller_profiles ON public.seller_profiles; CREATE TRIGGER trg_update_updated_at_seller_profiles BEFORE UPDATE ON public.seller_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_skill_listings ON public.skill_listings; CREATE TRIGGER trg_update_updated_at_skill_listings BEFORE UPDATE ON public.skill_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_updated_at_societies ON public.societies; CREATE TRIGGER trg_update_updated_at_societies BEFORE UPDATE ON public.societies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_update_worker_categories_updated_at ON public.society_worker_categories; CREATE TRIGGER trg_update_worker_categories_updated_at BEFORE UPDATE ON public.society_worker_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Validation triggers
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_validate_product_seller_category ON public.products; CREATE TRIGGER trg_validate_product_seller_category BEFORE INSERT OR UPDATE OF category, seller_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_product_seller_category(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_validate_product_store_action_type ON public.products; CREATE TRIGGER trg_validate_product_store_action_type BEFORE INSERT OR UPDATE OF action_type, seller_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_product_store_action_type(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_validate_session_feedback_rating ON public.session_feedback; CREATE TRIGGER trg_validate_session_feedback_rating BEFORE INSERT OR UPDATE ON public.session_feedback FOR EACH ROW EXECUTE FUNCTION public.validate_session_feedback_rating(); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Remaining triggers
DO $$ BEGIN DROP TRIGGER IF EXISTS update_featured_items_updated_at ON public.featured_items; CREATE TRIGGER update_featured_items_updated_at BEFORE UPDATE ON public.featured_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_live_activity_tokens_updated_at ON public.live_activity_tokens; CREATE TRIGGER update_live_activity_tokens_updated_at BEFORE UPDATE ON public.live_activity_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_recurring_config_updated_at ON public.service_recurring_configs; CREATE TRIGGER update_recurring_config_updated_at BEFORE UPDATE ON public.service_recurring_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS update_service_staff_updated_at ON public.service_staff; CREATE TRIGGER update_service_staff_updated_at BEFORE UPDATE ON public.service_staff FOR EACH ROW EXECUTE FUNCTION public.update_updated_at(); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS validate_cart_item_store_availability_trigger ON public.cart_items; CREATE TRIGGER validate_cart_item_store_availability_trigger BEFORE INSERT ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.validate_cart_item_store_availability(); EXCEPTION WHEN OTHERS THEN NULL; END $$;