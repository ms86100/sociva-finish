import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();
    const results: Record<string, any> = {};

    // Load admin-configured archivable statuses from system_settings
    const { data: settingsRows } = await supabase
      .from("system_settings")
      .select("key, value")
      .eq("key", "archivable_statuses")
      .single();

    let archivableStatuses: string[];
    try { archivableStatuses = JSON.parse(settingsRows?.value || '["completed"]'); }
    catch { archivableStatuses = ["completed"]; }

    // 1. Archive orders in archivable statuses older than 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: oldOrders, error: ordersFetchErr } = await supabase
      .from("orders")
      .select("*")
      .in("status", archivableStatuses)
      .lt("created_at", ninetyDaysAgo.toISOString())
      .limit(500);

    if (ordersFetchErr) {
      console.error("Error fetching old orders:", ordersFetchErr);
      results.orders = { error: ordersFetchErr.message };
    } else if (oldOrders && oldOrders.length > 0) {
      // Bug 5 fix: Filter out orders with pending/processing settlements before archiving
      const orderIds = oldOrders.map((o: any) => o.id);
      const { data: activeSettlements } = await supabase
        .from("seller_settlements")
        .select("order_id")
        .in("order_id", orderIds)
        .in("settlement_status", ["pending", "processing", "eligible"]);

      const blockedOrderIds = new Set((activeSettlements || []).map((s: any) => s.order_id));
      const safeOrders = oldOrders.filter((o: any) => !blockedOrderIds.has(o.id));

      if (blockedOrderIds.size > 0) {
        console.log(`Skipping ${blockedOrderIds.size} orders with active settlements`);
      }

      if (safeOrders.length === 0) {
        results.orders = { archived: 0, skipped_settlements: blockedOrderIds.size };
      } else {
        const archiveRows = safeOrders.map((o: any) => ({
          ...o,
          archived_at: now,
        }));

        const { error: archiveErr } = await supabase
          .from("orders_archive")
          .upsert(archiveRows, { onConflict: "id" });

        if (archiveErr) {
          console.error("Error archiving orders:", archiveErr);
          results.orders = { error: archiveErr.message };
        } else {
          const ids = safeOrders.map((o: any) => o.id);
          // Delete related records first
          for (const id of ids) {
            await supabase.from("order_items").delete().eq("order_id", id);
            await supabase.from("payment_records").delete().eq("order_id", id);
          }
          const { error: deleteErr } = await supabase
            .from("orders")
            .delete()
            .in("id", ids);

          results.orders = deleteErr
            ? { error: deleteErr.message }
            : { archived: safeOrders.length, skipped_settlements: blockedOrderIds.size };
        }
      }
    } else {
      results.orders = { archived: 0 };
    }

    // 2. Delete read notifications older than 60 days
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { count, error: notifErr } = await supabase
      .from("user_notifications")
      .delete()
      .eq("is_read", true)
      .lt("created_at", sixtyDaysAgo.toISOString());

    results.notifications = notifErr
      ? { error: notifErr.message }
      : { deleted: count || 0 };

    // 3. Archive audit log entries older than 1 year
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const { data: oldLogs, error: logsFetchErr } = await supabase
      .from("audit_log")
      .select("*")
      .lt("created_at", oneYearAgo.toISOString())
      .limit(500);

    if (logsFetchErr) {
      results.audit_log = { error: logsFetchErr.message };
    } else if (oldLogs && oldLogs.length > 0) {
      const archiveLogs = oldLogs.map((l: any) => ({
        ...l,
        archived_at: now,
      }));

      const { error: archiveErr } = await supabase
        .from("audit_log_archive")
        .upsert(archiveLogs, { onConflict: "id" });

      if (archiveErr) {
        results.audit_log = { error: archiveErr.message };
      } else {
        const ids = oldLogs.map((l: any) => l.id);
        const { error: deleteErr } = await supabase
          .from("audit_log")
          .delete()
          .in("id", ids);

        results.audit_log = deleteErr
          ? { error: deleteErr.message }
          : { archived: oldLogs.length };
      }
    } else {
      results.audit_log = { archived: 0 };
    }

    // 4. Clean processed notification queue entries older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { error: queueErr } = await supabase
      .from("notification_queue")
      .delete()
      .in("status", ["processed", "failed"])
      .lt("created_at", sevenDaysAgo.toISOString());

    results.notification_queue = queueErr
      ? { error: queueErr.message }
      : { cleaned: true };

    console.log("Archive results:", results);
    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in archive-old-data:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
