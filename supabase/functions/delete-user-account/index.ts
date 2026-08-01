import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { withAuth } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase 5: Centralized auth
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    // Phase 2: Rate limit — 3 per hour
    const { allowed } = await checkRateLimit(`delete-account:${userId}`, 3, 3600);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ─── Phase 1: Resolve seller IDs owned by this user ───
    const { data: sellerRows } = await supabaseAdmin
      .from('seller_profiles')
      .select('id')
      .eq('user_id', userId);

    const sellerIds = (sellerRows || []).map((r: any) => r.id);

    // Continue-on-error: track failures but never abort — auth user MUST be deleted
    const failures: string[] = [];

    async function del(table: string, column: string, value: string) {
      const { error } = await supabaseAdmin.from(table).delete().eq(column, value);
      if (error) {
        console.error(`[delete-account] Failed ${table}.${column}:`, error.message);
        failures.push(`${table}.${column}`);
      }
    }

    async function delMany(table: string, column: string, values: string[]) {
      if (values.length === 0) return;
      const { error } = await supabaseAdmin.from(table).delete().in(column, values);
      if (error) {
        console.error(`[delete-account] Failed ${table}.${column}:`, error.message);
        failures.push(`${table}.${column}`);
      }
    }

    // ─── Phase 2: Delete seller-owned data (must happen before products) ───
    if (sellerIds.length > 0) {
      // Product-child tables first (FK deps)
      await delMany('service_addons', 'product_id',
        await supabaseAdmin.from('products').select('id').in('seller_id', sellerIds)
          .then(r => (r.data || []).map((p: any) => p.id))
      );
      await delMany('service_slots', 'seller_id', sellerIds);
      await delMany('service_staff', 'seller_id', sellerIds);
      await delMany('service_availability_schedules', 'seller_id', sellerIds);
      await delMany('service_recurring_configs', 'seller_id', sellerIds);
      await delMany('seller_contact_interactions', 'seller_id', sellerIds);
      await delMany('seller_conversation_messages', 'seller_id',
        await supabaseAdmin.from('seller_conversations').select('id').in('seller_id', sellerIds)
          .then(r => (r.data || []).map((c: any) => c.id))
      );
      await delMany('seller_conversations', 'seller_id', sellerIds);
      await delMany('seller_form_configs', 'seller_id', sellerIds);
      await delMany('seller_licenses', 'seller_id', sellerIds);
      await delMany('seller_recommendations', 'seller_id', sellerIds);
      await delMany('seller_reputation_ledger', 'seller_id', sellerIds);
      await delMany('seller_settlements', 'seller_id', sellerIds);
      await delMany('coupons', 'seller_id', sellerIds);
      await delMany('delivery_time_stats', 'seller_id', sellerIds);
      await delMany('order_suggestions', 'seller_id', sellerIds);
      await delMany('marketplace_events', 'seller_id', sellerIds);
      await delMany('service_bookings', 'seller_id', sellerIds);

      // Anonymize payment/settlement records (financial — retain but strip PII)
      for (const sid of sellerIds) {
        await supabaseAdmin.from('payment_settlements').update({ notes: null }).eq('seller_id', sid);
        await supabaseAdmin.from('payment_records').update({ notes: null }).eq('seller_id', sid);
      }

      // Delete products (will cascade product_favorites, product_views via FK if set, otherwise clean manually)
      const productIds = await supabaseAdmin.from('products').select('id').in('seller_id', sellerIds)
        .then(r => (r.data || []).map((p: any) => p.id));

      if (productIds.length > 0) {
        await delMany('product_favorites', 'product_id', productIds);
        await delMany('product_views', 'product_id', productIds);
        await delMany('price_history', 'product_id', productIds);
        await delMany('stock_watchlist', 'product_id', productIds);
        await delMany('slot_waitlist', 'product_id', productIds);
        await delMany('subscriptions', 'product_id', productIds);
        await delMany('service_listings', 'product_id', productIds);
      }

      await delMany('products', 'seller_id', sellerIds);
      await delMany('reviews', 'seller_id', sellerIds);
      await delMany('favorites', 'seller_id', sellerIds);
      await delMany('delivery_feedback', 'seller_id', sellerIds);
      await delMany('call_feedback', 'seller_id', sellerIds);
      await delMany('seller_profiles', 'id', sellerIds);
    }

    // ─── Phase 3: Delete user-owned personal data ───
    const userTables: { table: string; column: string }[] = [
      // Activity & engagement
      { table: 'cart_items', column: 'user_id' },
      { table: 'device_tokens', column: 'user_id' },
      { table: 'favorites', column: 'user_id' },
      { table: 'product_favorites', column: 'user_id' },
      { table: 'product_views', column: 'viewer_id' },
      { table: 'reviews', column: 'buyer_id' },
      { table: 'warnings', column: 'user_id' },
      { table: 'reports', column: 'reporter_id' },
      { table: 'marketplace_events', column: 'user_id' },
      { table: 'milestone_reactions', column: 'user_id' },
      // Notifications & tokens
      { table: 'notification_queue', column: 'user_id' },
      { table: 'notification_preferences', column: 'user_id' },
      { table: 'user_notifications', column: 'user_id' },
      { table: 'live_activity_tokens', column: 'user_id' },
      { table: 'push_logs', column: 'user_id' },
      { table: 'phone_otp_verifications', column: 'user_id' },
      // Bulletin / community
      { table: 'bulletin_votes', column: 'user_id' },
      { table: 'bulletin_rsvps', column: 'user_id' },
      { table: 'bulletin_comments', column: 'author_id' },
      { table: 'bulletin_posts', column: 'author_id' },
      // Help & skills
      { table: 'help_responses', column: 'responder_id' },
      { table: 'help_requests', column: 'author_id' },
      { table: 'skill_endorsements', column: 'endorser_id' },
      { table: 'skill_listings', column: 'user_id' },
      // Society roles & staff
      { table: 'society_admins', column: 'user_id' },
      { table: 'security_staff', column: 'user_id' },
      // Chat (only sender — receiver messages belong to other users)
      { table: 'chat_messages', column: 'sender_id' },
      { table: 'seller_conversation_messages', column: 'sender_id' },
      // Delivery & addresses
      { table: 'delivery_addresses', column: 'user_id' },
      { table: 'delivery_locations', column: 'partner_id' },
      // Buyer interactions
      { table: 'call_feedback', column: 'buyer_id' },
      { table: 'delivery_feedback', column: 'buyer_id' },
      { table: 'seller_contact_interactions', column: 'buyer_id' },
      { table: 'session_feedback', column: 'buyer_id' },
      { table: 'service_bookings', column: 'buyer_id' },
      { table: 'service_recurring_configs', column: 'buyer_id' },
      { table: 'order_suggestions', column: 'user_id' },
      { table: 'coupon_redemptions', column: 'user_id' },
      { table: 'collective_buy_participants', column: 'user_id' },
      { table: 'collective_buy_requests', column: 'created_by' },
      // Society / resident
      { table: 'authorized_persons', column: 'resident_id' },
      { table: 'gate_entries', column: 'user_id' },
      { table: 'domestic_help_entries', column: 'resident_id' },
      { table: 'inspection_checklists', column: 'resident_id' },
      { table: 'maintenance_dues', column: 'resident_id' },
      { table: 'manual_entry_requests', column: 'resident_id' },
      { table: 'parcel_entries', column: 'resident_id' },
      { table: 'resident_payments', column: 'resident_id' },
      { table: 'payment_milestones', column: 'created_by' },
      // Disputes & expenses
      { table: 'dispute_comments', column: 'author_id' },
      { table: 'expense_views', column: 'user_id' },
      { table: 'expense_flags', column: 'flagged_by' },
      // Builder
      { table: 'construction_milestones', column: 'posted_by' },
      { table: 'builder_announcements', column: 'posted_by' },
      { table: 'builder_members', column: 'user_id' },
      // Delivery partner pool (if user is a delivery partner)
      { table: 'delivery_partner_pool', column: 'user_id' },
    ];

    for (const { table, column } of userTables) {
      await del(table, column, userId);
    }

    // ─── Phase 4: Anonymize financial records (must retain for audit) ───
    const { error: orderErr } = await supabaseAdmin
      .from('orders')
      .update({ delivery_address: null, notes: null })
      .eq('buyer_id', userId);
    if (orderErr) {
      console.error('[delete-account] Failed to anonymize orders:', orderErr.message);
      failures.push('orders.anonymize');
    }

    // ─── Phase 5: Delete roles & profile ───
    await del('user_roles', 'user_id', userId);
    await del('profiles', 'id', userId);

    if (failures.length > 0) {
      console.warn(`[delete-account] ${failures.length} cleanup failures for user ${userId}:`, failures.join(', '));
    }

    // ─── Phase 6: Delete auth user (MUST succeed) ───
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError);
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
