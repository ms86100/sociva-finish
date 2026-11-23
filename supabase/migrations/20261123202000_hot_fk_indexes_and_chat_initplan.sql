-- Hot marketplace FK covering indexes + chat_messages initplan fix (staging hardening).

create index if not exists idx_orders_buyer_society_id on public.orders (buyer_society_id);
create index if not exists idx_orders_seller_society_id on public.orders (seller_society_id);
create index if not exists idx_orders_society_id on public.orders (society_id);
create index if not exists idx_orders_coupon_id on public.orders (coupon_id);
create index if not exists idx_order_items_product_id on public.order_items (product_id);
create index if not exists idx_order_otp_codes_order_id on public.order_otp_codes (order_id);
create index if not exists idx_cart_items_product_id on public.cart_items (product_id);
create index if not exists idx_cart_add_log_user_id on public.cart_add_log (user_id);
create index if not exists idx_conversation_messages_sender_id on public.conversation_messages (sender_id);
create index if not exists idx_conversations_created_by on public.conversations (created_by);
create index if not exists idx_notification_queue_rule_id on public.notification_queue (rule_id);
create index if not exists idx_order_suggestions_seller_id on public.order_suggestions (seller_id);
create index if not exists idx_order_suggestions_society_id on public.order_suggestions (society_id);

drop policy if exists "Users can mark messages as read" on public.chat_messages;
create policy "Users can mark messages as read" on public.chat_messages
  for update using (receiver_id = (select auth.uid()));

drop policy if exists "Users can view their own chat messages" on public.chat_messages;
create policy "Users can view their own chat messages" on public.chat_messages
  for select using (
    (sender_id = (select auth.uid()))
    or (receiver_id = (select auth.uid()))
    or is_admin((select auth.uid()))
  );
