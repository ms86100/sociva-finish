DO $$
DECLARE
  v_user uuid := 'b3220352-30c5-4d23-98b1-f0911074f444';
  v_seller uuid := 'c1000000-0000-0000-0000-000000000002';
  stmt text;
  stmts text[] := ARRAY[
    -- Order-children (broad: by buyer or by seller via orders join)
    'DELETE FROM public.order_items        WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.order_otp_codes    WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.delivery_assignments WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.delivery_tracking_logs WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.delivery_locations WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.delivery_feedback  WHERE order_id IN (SELECT id FROM public.orders WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.refund_audit_log   WHERE refund_request_id IN (SELECT id FROM public.refund_requests WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.refund_requests    WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.payment_records    WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.payment_ledger     WHERE user_id=$1',
    'DELETE FROM public.payment_settlements WHERE seller_id=$2',
    'DELETE FROM public.dispute_comments   WHERE dispute_id IN (SELECT id FROM public.disputes WHERE buyer_id=$1 OR seller_id=$2)',
    'DELETE FROM public.disputes           WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.reviews            WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.review_prompts     WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.chat_messages      WHERE sender_id=$1 OR receiver_id=$1',
    'DELETE FROM public.call_feedback      WHERE buyer_id=$1 OR seller_id=$2',
    'DELETE FROM public.session_feedback   WHERE buyer_id=$1 OR user_id=$1',
    'DELETE FROM public.coupon_redemptions WHERE user_id=$1',
    'DELETE FROM public.transaction_audit_trail WHERE actor_id=$1',
    'DELETE FROM public.live_activity_tokens WHERE user_id=$1',
    'DELETE FROM public.orders             WHERE buyer_id=$1 OR seller_id=$2',
    -- Product children
    'DELETE FROM public.product_favorites  WHERE product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.product_views      WHERE product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.product_edit_snapshots WHERE product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.price_history      WHERE product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.banner_section_products WHERE product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.cart_items         WHERE user_id=$1 OR product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.favorites          WHERE user_id=$1 OR seller_id=$2 OR product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.stock_watchlist    WHERE user_id=$1 OR product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.collective_buy_participants WHERE user_id=$1 OR request_id IN (SELECT id FROM public.collective_buy_requests WHERE created_by=$1 OR product_id IN (SELECT id FROM public.products WHERE seller_id=$2))',
    'DELETE FROM public.collective_buy_requests WHERE created_by=$1 OR product_id IN (SELECT id FROM public.products WHERE seller_id=$2)',
    'DELETE FROM public.order_suggestions  WHERE user_id=$1 OR seller_id=$2',
    'DELETE FROM public.ai_review_log      WHERE seller_id=$2',
    'DELETE FROM public.products           WHERE seller_id=$2',
    -- Seller-scoped
    'DELETE FROM public.category_requests  WHERE seller_id=$2',
    'DELETE FROM public.coupons            WHERE seller_id=$2',
    'DELETE FROM public.delivery_time_stats WHERE seller_id=$2',
    'DELETE FROM public.festival_seller_participation WHERE seller_id=$2',
    'DELETE FROM public.marketplace_events WHERE seller_id=$2',
    'DELETE FROM public.seller_contact_interactions WHERE seller_id=$2 OR buyer_id=$1',
    'DELETE FROM public.seller_conversation_messages WHERE conversation_id IN (SELECT id FROM public.seller_conversations WHERE seller_id=$2 OR buyer_id=$1)',
    'DELETE FROM public.seller_conversations WHERE seller_id=$2 OR buyer_id=$1',
    'DELETE FROM public.seller_licenses    WHERE seller_id=$2',
    'DELETE FROM public.seller_performance_metrics WHERE seller_id=$2',
    'DELETE FROM public.seller_quick_replies WHERE seller_id=$2',
    'DELETE FROM public.seller_recommendations WHERE seller_id=$2',
    'DELETE FROM public.seller_reputation_ledger WHERE seller_id=$2',
    'DELETE FROM public.seller_settlements WHERE seller_id=$2',
    'DELETE FROM public.service_availability_schedules WHERE seller_id=$2',
    'DELETE FROM public.service_bookings   WHERE seller_id=$2 OR buyer_id=$1',
    'DELETE FROM public.service_recurring_configs WHERE seller_id=$2 OR buyer_id=$1',
    'DELETE FROM public.service_slots      WHERE seller_id=$2',
    'DELETE FROM public.service_staff      WHERE seller_id=$2',
    'DELETE FROM public.featured_items     WHERE seller_id=$2',
    -- User-scoped
    'DELETE FROM public.user_notifications WHERE user_id=$1',
    'DELETE FROM public.notification_preferences WHERE user_id=$1',
    'DELETE FROM public.notification_audit_log WHERE user_id=$1',
    'DELETE FROM public.notification_queue WHERE user_id=$1',
    'DELETE FROM public.push_logs          WHERE user_id=$1',
    'DELETE FROM public.device_tokens      WHERE user_id=$1',
    'DELETE FROM public.delivery_addresses WHERE user_id=$1',
    'DELETE FROM public.delivery_partner_pool WHERE user_id=$1',
    'DELETE FROM public.delivery_partners  WHERE user_id=$1',
    'DELETE FROM public.expense_views      WHERE user_id=$1',
    'DELETE FROM public.gate_entries       WHERE user_id=$1',
    'DELETE FROM public.loyalty_points     WHERE user_id=$1',
    'DELETE FROM public.milestone_reactions WHERE user_id=$1',
    'DELETE FROM public.phone_otp_verifications WHERE user_id=$1',
    'DELETE FROM public.search_demand_log  WHERE user_id=$1',
    'DELETE FROM public.skill_listings     WHERE user_id=$1',
    'DELETE FROM public.slot_waitlist      WHERE user_id=$1',
    'DELETE FROM public.society_admins     WHERE user_id=$1',
    'DELETE FROM public.security_staff     WHERE user_id=$1',
    'DELETE FROM public.society_workers    WHERE user_id=$1',
    'DELETE FROM public.banner_analytics   WHERE user_id=$1',
    'DELETE FROM public.builder_members    WHERE user_id=$1',
    'DELETE FROM public.bulletin_rsvps     WHERE user_id=$1',
    'DELETE FROM public.bulletin_votes     WHERE user_id=$1',
    'DELETE FROM public.bulletin_comments  WHERE user_id=$1',
    'DELETE FROM public.bulletin_posts     WHERE author_id=$1',
    'DELETE FROM public.help_responses     WHERE responder_id=$1',
    'DELETE FROM public.help_requests      WHERE requester_id=$1',
    'DELETE FROM public.warnings           WHERE user_id=$1',
    'DELETE FROM public.reports            WHERE reporter_id=$1',
    'DELETE FROM public.support_ticket_messages WHERE sender_id=$1',
    'DELETE FROM public.support_tickets    WHERE user_id=$1',
    'DELETE FROM public.subscriptions      WHERE buyer_id=$1',
    'DELETE FROM public.user_feedback      WHERE user_id=$1',
    'DELETE FROM public.user_roles         WHERE user_id=$1',
    'DELETE FROM public.seller_profiles    WHERE user_id=$1',
    'DELETE FROM public.profiles           WHERE id=$1',
    -- Storage: remove all files under user folder
    'DELETE FROM storage.objects WHERE name LIKE $3 AND bucket_id IN (SELECT id FROM storage.buckets)',
    -- Finally the auth user
    'DELETE FROM auth.users WHERE id=$1'
  ];
  v_prefix text := 'b3220352-30c5-4d23-98b1-f0911074f444/%';
BEGIN
  FOREACH stmt IN ARRAY stmts LOOP
    BEGIN
      EXECUTE stmt USING v_user, v_seller, v_prefix;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped: % -- %', stmt, SQLERRM;
    END;
  END LOOP;
END $$;