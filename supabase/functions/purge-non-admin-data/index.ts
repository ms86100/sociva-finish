import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const start = Date.now();

  try {
    // Auth: must be logged-in admin
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify caller is admin
    const { data: adminRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Get all admin user IDs to preserve
    const { data: adminRoles } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminIds = (adminRoles || []).map((r: any) => r.user_id);
    console.log(`Preserving ${adminIds.length} admin(s):`, adminIds);

    // Step 2: Get all non-admin user IDs
    const { data: allProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id');

    const allUserIds = (allProfiles || []).map((p: any) => p.id);
    const nonAdminIds = allUserIds.filter((id: string) => !adminIds.includes(id));
    console.log(`Found ${nonAdminIds.length} non-admin users to delete`);

    // Step 3: Delete transactional data (order matters for FK constraints)
    const transactionalTables = [
      // Chat & notifications
      { table: 'chat_messages', filter: null },
      { table: 'user_notifications', filter: null },
      { table: 'notification_queue', filter: null },
      // Orders & payments
      { table: 'coupon_redemptions', filter: null },
      { table: 'order_items', filter: null },
      { table: 'order_status_history', filter: null },
      { table: 'delivery_assignments', filter: null },
      { table: 'orders', filter: null },
      { table: 'payment_settlements', filter: null },
      // Cart & favorites
      { table: 'cart_items', filter: null },
      { table: 'favorites', filter: null },
      // Reviews & reports
      { table: 'reviews', filter: null },
      { table: 'reports', filter: null },
      { table: 'warnings', filter: null },
      // Bulletin
      { table: 'bulletin_votes', filter: null },
      { table: 'bulletin_rsvps', filter: null },
      { table: 'bulletin_comments', filter: null },
      { table: 'bulletin_posts', filter: null },
      // Help
      { table: 'help_responses', filter: null },
      { table: 'help_requests', filter: null },
      // Disputes
      { table: 'dispute_comments', filter: null },
      { table: 'disputes', filter: null },
      // Collective buy
      { table: 'collective_buy_participants', filter: null },
      { table: 'collective_buy_requests', filter: null },
      // Finances
      { table: 'expense_flags', filter: null },
      { table: 'expense_views', filter: null },
      { table: 'expenses', filter: null },
      // Security & gate
      { table: 'gate_entries', filter: null },
      { table: 'visitor_passes', filter: null },
      { table: 'authorized_persons', filter: null },
      // Workers
      { table: 'worker_leave_records', filter: null },
      { table: 'worker_salary_records', filter: null },
      { table: 'worker_attendance', filter: null },
      { table: 'worker_assignments', filter: null },
      { table: 'workers', filter: null },
      // Skills
      { table: 'skill_endorsements', filter: null },
      { table: 'skill_listings', filter: null },
      // Snags & construction
      { table: 'snag_comments', filter: null },
      { table: 'snag_list', filter: null },
      { table: 'collective_escalations', filter: null },
      { table: 'construction_milestones', filter: null },
      { table: 'project_documents', filter: null },
      { table: 'project_qa', filter: null },
      // Subscriptions & bookings
      { table: 'subscription_items', filter: null },
      { table: 'subscriptions', filter: null },
      // Coupons
      { table: 'coupons', filter: null },
      // Products
      { table: 'product_attribute_values', filter: null },
      { table: 'products', filter: null },
      // Seller profiles
      { table: 'seller_profiles', filter: null },
      // Builder announcements
      { table: 'builder_announcements', filter: null },
      // Delivery partner pool
      { table: 'delivery_partner_pool', filter: null },
      // Device tokens
      { table: 'device_tokens', filter: null },
      // Audit log (transactional, not config)
      { table: 'audit_log', filter: null },
      { table: 'audit_log_archive', filter: null },
      // Maintenance
      { table: 'maintenance_dues', filter: null },
      // Parcels & vehicles
      { table: 'parcels', filter: null },
      { table: 'vehicles', filter: null },
      // Notices
      { table: 'society_notices', filter: null },
    ];

    const deletedCounts: Record<string, number> = {};

    for (const { table } of transactionalTables) {
      try {
        const { count, error } = await supabaseAdmin
          .from(table)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000') // delete all rows
          .select('id', { count: 'exact', head: true });

        deletedCounts[table] = count || 0;
        if (error) {
          console.warn(`Warning deleting from ${table}:`, error.message);
        }
      } catch (e) {
        console.warn(`Table ${table} may not exist, skipping:`, e);
      }
    }

    // Step 4: Delete non-admin user roles
    if (nonAdminIds.length > 0) {
      await supabaseAdmin
        .from('user_roles')
        .delete()
        .in('user_id', nonAdminIds);

      // Step 5: Delete non-admin society_admins
      await supabaseAdmin
        .from('society_admins')
        .delete()
        .in('user_id', nonAdminIds);

      // Step 6: Delete non-admin security_staff
      await supabaseAdmin
        .from('security_staff')
        .delete()
        .in('user_id', nonAdminIds);

      // Step 7: Delete non-admin profiles
      await supabaseAdmin
        .from('profiles')
        .delete()
        .in('id', nonAdminIds);

      // Step 8: Delete non-admin auth users
      let authDeleted = 0;
      for (const uid of nonAdminIds) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (error) {
          console.warn(`Failed to delete auth user ${uid}:`, error.message);
        } else {
          authDeleted++;
        }
      }
      deletedCounts['auth_users'] = authDeleted;
    }

    const duration_ms = Date.now() - start;

    return new Response(JSON.stringify({
      success: true,
      duration_ms,
      summary: {
        admins_preserved: adminIds.length,
        users_deleted: nonAdminIds.length,
        tables_cleaned: Object.keys(deletedCounts).length,
        details: deletedCounts,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Purge error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
