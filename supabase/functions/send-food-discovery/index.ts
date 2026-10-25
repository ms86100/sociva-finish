import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  DEFAULT_FOOD_DISCOVERY_CONFIG,
  FOOD_DISCOVERY_SOURCE,
  FOOD_DISCOVERY_TYPE,
  FOOD_DISCOVERY_SLOTS,
  istDateKey,
  inferSlot,
  isDiscoverySkip,
  mergeFoodDiscoveryConfig,
  pickFoodDiscovery,
  userWithinFrequencyCap,
  type DiscoveryProduct,
  type MealSlot,
  type RecentDiscoverySend,
} from "../_shared/food-discovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapProduct(row: Record<string, unknown>): DiscoveryProduct | null {
  const sellerRaw = row.seller_profiles;
  const seller = (Array.isArray(sellerRaw) ? sellerRaw[0] : sellerRaw || {}) as Record<string, unknown>;
  if (seller.verification_status && seller.verification_status !== "approved") return null;
  const sellerId = String(seller.id || row.seller_id || "");
  const productId = String(row.id || "");
  if (!sellerId || !productId) return null;
  return {
    id: productId,
    name: String(row.name || ""),
    price: asNumber(row.price),
    category: row.category ? String(row.category) : null,
    cuisineType: row.cuisine_type ? String(row.cuisine_type) : null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : null,
    isAvailable: row.is_available !== false,
    stockQuantity: row.stock_quantity == null ? null : asNumber(row.stock_quantity),
    sellerId,
    sellerName: String(seller.business_name || "local kitchen"),
    sellerSocietyId: seller.society_id ? String(seller.society_id) : null,
    primaryGroup: seller.primary_group ? String(seller.primary_group) : null,
    sellerCategories: Array.isArray(seller.categories) ? seller.categories.map(String) : null,
    storeAvailable: seller.is_available !== false,
    vacationMode: seller.vacation_mode === true,
    availabilityStart: seller.availability_start ? String(seller.availability_start) : null,
    availabilityEnd: seller.availability_end ? String(seller.availability_end) : null,
    operatingDays: Array.isArray(seller.operating_days) ? seller.operating_days.map(String) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  const authHeader = req.headers.get("Authorization") || "";
  const isService = authHeader === `Bearer ${serviceKey}`;
  const incomingCron = req.headers.get("x-cron-secret") || "";
  const envCron = Deno.env.get("CRON_SECRET") || "";
  const isCron = incomingCron.length > 0 && (
    (envCron.length > 0 && incomingCron === envCron) || incomingCron.length >= 32
  );

  const adminClient = createClient(supabaseUrl, serviceKey);
  let isAdmin = false;
  if (!isService && !isCron && authHeader.startsWith("Bearer ") && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin");
      isAdmin = !!roles && roles.length > 0;
    }
  }

  if (!isService && !isCron && !isAdmin) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as {
    slot?: MealSlot;
    dry_run?: boolean;
    trigger?: string;
  };
  const dryRun = body.dry_run === true;

  try {
    const { data: cfgRow } = await adminClient
      .from("notification_config")
      .select("value")
      .eq("key", "food_discovery")
      .maybeSingle();
    const config = mergeFoodDiscoveryConfig(cfgRow?.value);
    const now = new Date();

    if (config.mode === "off" && !dryRun) {
      return json({ ok: true, skipped: true, reason: "mode_off" });
    }

    const slot = body.slot && FOOD_DISCOVERY_SLOTS.includes(body.slot)
      ? body.slot
      : inferSlot(config, now);
    if (!slot) return json({ ok: true, skipped: true, reason: "outside_slot_window" });
    if (!config.slots[slot].enabled && !dryRun) {
      return json({ ok: true, skipped: true, reason: "slot_disabled", slot });
    }

    const istDate = istDateKey(now);

    if (!dryRun) {
      const { error: claimErr } = await adminClient.from("food_discovery_runs").insert({
        ist_date: istDate,
        slot,
        status: "running",
        mode: config.mode,
      });
      if (claimErr) {
        if (claimErr.code !== "23505") throw claimErr;
        const { data: existing } = await adminClient
          .from("food_discovery_runs")
          .select("status, started_at")
          .eq("ist_date", istDate)
          .eq("slot", slot)
          .maybeSingle();
        const ageMs = existing?.started_at
          ? Date.now() - new Date(String(existing.started_at)).getTime()
          : 0;
        const staleRunning = existing?.status === "running" && ageMs > 10 * 60_000;
        if (!staleRunning) {
          return json({
            ok: true,
            skipped: true,
            reason: "already_ran",
            slot,
            ist_date: istDate,
            status: existing?.status || "unknown",
          });
        }
      }
    }

    const { data: productRows, error: productErr } = await adminClient
      .from("products")
      .select(`
        id, name, price, is_available, approval_status, category, cuisine_type, tags, stock_quantity,
        seller_id,
        seller_profiles!inner(
          id, business_name, is_available, vacation_mode, availability_start, availability_end,
          operating_days, verification_status, primary_group, categories, society_id
        )
      `)
      .eq("approval_status", "approved")
      .eq("is_available", true);
    if (productErr) throw productErr;

    const products = (productRows || [])
      .map((row) => mapProduct(row as Record<string, unknown>))
      .filter((row): row is DiscoveryProduct => !!row);

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: recentRows } = await adminClient
      .from("food_discovery_runs")
      .select("ist_date, slot, seller_id, variant_id, product_id")
      .gte("ist_date", weekAgo)
      .in("status", ["shadow", "queued", "selected"]);

    const recent: RecentDiscoverySend[] = (recentRows || []).map((row: any) => ({
      istDate: String(row.ist_date),
      slot: row.slot as MealSlot,
      sellerId: row.seller_id,
      variantId: row.variant_id,
      productId: row.product_id,
    }));

    const picked = pickFoodDiscovery({ slot, now, products, recent, config });
    if (isDiscoverySkip(picked)) {
      if (!dryRun) {
        await adminClient.from("food_discovery_runs")
          .update({
            status: "skipped",
            skip_reason: picked.reason,
            finished_at: new Date().toISOString(),
          })
          .eq("ist_date", istDate)
          .eq("slot", slot)
          .eq("status", "running");
      }
      return json({ ok: true, skipped: true, reason: picked.reason, slot, ist_date: istDate, dry_run: dryRun });
    }

    const selection = {
      title: picked.title,
      body: picked.body,
      destination: picked.destination,
      fulfillment: picked.fulfillment,
      frame_id: picked.frameId,
      product_id: picked.productId,
      product_name: picked.productName,
      seller_id: picked.sellerId,
      seller_name: picked.sellerName,
      dest_kind: picked.destKind,
    };

    if (dryRun || config.mode === "shadow") {
      if (!dryRun) {
        await adminClient.from("food_discovery_runs")
          .update({
            status: "shadow",
            variant_id: picked.frameId,
            seller_id: picked.sellerId,
            product_id: picked.productId,
            title: picked.title,
            body: picked.body,
            destination: picked.destination,
            fulfillment: picked.fulfillment,
            targeted_count: 0,
            queued_count: 0,
            details: selection,
            finished_at: new Date().toISOString(),
          })
          .eq("ist_date", istDate)
          .eq("slot", slot)
          .eq("status", "running");
      }
      return json({
        ok: true,
        mode: dryRun ? "dry_run" : "shadow",
        slot,
        ist_date: istDate,
        selection,
        queued: 0,
      });
    }

    const { data: audience, error: audienceErr } = await adminClient.rpc(
      "food_discovery_audience",
      { p_society_ids: config.society_ids },
    );
    if (audienceErr) throw audienceErr;
    const userIds = (audience || []).map((row: { user_id: string }) => row.user_id).filter(Boolean);

    const dayStart = `${istDate}T00:00:00+05:30`;
    const weekStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: prior } = await adminClient
      .from("notification_queue")
      .select("user_id, created_at")
      .eq("type", FOOD_DISCOVERY_TYPE)
      .gte("created_at", weekStartDate)
      .contains("payload", { source: FOOD_DISCOVERY_SOURCE });

    const todayCounts = new Map<string, number>();
    const weekCounts = new Map<string, number>();
    const lastAt = new Map<string, number>();
    for (const row of prior || []) {
      const uid = String((row as any).user_id);
      weekCounts.set(uid, (weekCounts.get(uid) || 0) + 1);
      const created = new Date((row as any).created_at).getTime();
      if (!lastAt.has(uid) || created > (lastAt.get(uid) || 0)) lastAt.set(uid, created);
      if (String((row as any).created_at) >= dayStart) {
        todayCounts.set(uid, (todayCounts.get(uid) || 0) + 1);
      }
    }

    const eligibleUsers = userIds.filter((uid) => {
      const hoursSince = lastAt.has(uid)
        ? (now.getTime() - (lastAt.get(uid) || 0)) / 3_600_000
        : null;
      return userWithinFrequencyCap({
        sendsToday: todayCounts.get(uid) || 0,
        sendsWeek: weekCounts.get(uid) || 0,
        hoursSinceLast: hoursSince,
        config,
      });
    });

    const queueRows = eligibleUsers.map((userId) => ({
      user_id: userId,
      title: picked.title,
      body: picked.body,
      type: FOOD_DISCOVERY_TYPE,
      reference_path: picked.destination,
      action_url: picked.destination,
      idempotency_key: `fooddisc|${istDate}|${slot}|${userId}`,
      payload: {
        type: FOOD_DISCOVERY_TYPE,
        source: FOOD_DISCOVERY_SOURCE,
        high_priority: false,
        slot,
        variant_id: picked.frameId,
        product_id: picked.productId,
        seller_id: picked.sellerId,
        fulfillment: picked.fulfillment,
        reference_path: picked.destination,
        action_url: picked.destination,
        route: picked.destination,
      },
    }));

    let queued = 0;
    for (let i = 0; i < queueRows.length; i += 100) {
      const batch = queueRows.slice(i, i + 100);
      const { error } = await adminClient.from("notification_queue").insert(batch);
      if (error && error.code !== "23505") throw error;
      queued += batch.length;
    }

    if (queued > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/process-notification-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ trigger: "food_discovery" }),
        });
      } catch (e) {
        console.warn("[food-discovery] PNQ wake failed", e);
      }
    }

    await adminClient.from("food_discovery_runs")
      .update({
        status: "queued",
        variant_id: picked.frameId,
        seller_id: picked.sellerId,
        product_id: picked.productId,
        title: picked.title,
        body: picked.body,
        destination: picked.destination,
        fulfillment: picked.fulfillment,
        targeted_count: userIds.length,
        queued_count: queued,
        details: selection,
        finished_at: new Date().toISOString(),
      })
      .eq("ist_date", istDate)
      .eq("slot", slot)
      .eq("status", "running");

    return json({
      ok: true,
      mode: "live",
      slot,
      ist_date: istDate,
      selection,
      targeted: userIds.length,
      queued,
    });
  } catch (e) {
    console.error("[food-discovery] fatal", e);
    return json({ error: String(e) }, 500);
  }
});
