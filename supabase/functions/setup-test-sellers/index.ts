import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOCIETY_ID = "a0000000-0000-0000-0000-000000000001"; // Shriram Greenfield

const TEST_SELLERS = [
  {
    phone: "+918448802907",
    name: "Sagar Sharma",
    email: "sagar.sharma@test.sociva.app",
    flat_number: "A-304",
    block: "Tower A",
    store_name: "Sagar's Kitchen",
    store_description: "Authentic home-cooked meals and fresh bakery items delivered to your doorstep.",
    categories: ["home_food", "bakery"],
    latitude: 13.0722,
    longitude: 77.7542,
    products: [
      { name: "Paneer Butter Masala", category: "home_food", price: 10, description: "Rich creamy paneer in butter gravy", is_veg: true },
      { name: "Dal Makhani", category: "home_food", price: 10, description: "Slow-cooked black dal with cream", is_veg: true },
      { name: "Chocolate Brownie", category: "bakery", price: 10, description: "Freshly baked fudgy chocolate brownie", is_veg: true },
      { name: "Banana Bread", category: "bakery", price: 10, description: "Moist banana bread with walnuts", is_veg: true },
    ],
  },
  {
    phone: "+917838459432",
    name: "Priya Reddy",
    email: "priya.reddy@test.sociva.app",
    flat_number: "B-512",
    block: "Tower B",
    store_name: "Priya's Snack Bar",
    store_description: "Tasty snacks and refreshing beverages for every occasion.",
    categories: ["snacks", "beverages"],
    latitude: 13.0712,
    longitude: 77.7535,
    products: [
      { name: "Masala Vada", category: "snacks", price: 10, description: "Crispy spiced lentil fritters", is_veg: true },
      { name: "Samosa (2 pcs)", category: "snacks", price: 10, description: "Golden fried potato samosas", is_veg: true },
      { name: "Fresh Lime Soda", category: "beverages", price: 10, description: "Chilled sweet lime soda", is_veg: true },
      { name: "Mango Lassi", category: "beverages", price: 10, description: "Thick creamy mango yogurt drink", is_veg: true },
    ],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const start = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Step 1: Purge non-admin users ──────────────────────────────
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles || []).map((r: any) => r.user_id);
    console.log(`Preserving ${adminIds.length} admin(s)`);

    // Delete non-admin auth users
    const { data: allUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const usersToDelete = (allUsers?.users || []).filter((u: any) => !adminIds.includes(u.id));
    let deletedCount = 0;
    for (const u of usersToDelete) {
      const { error } = await supabase.auth.admin.deleteUser(u.id);
      if (!error) deletedCount++;
      else console.warn(`Failed to delete ${u.id}: ${error.message}`);
    }
    console.log(`Deleted ${deletedCount} non-admin users`);

    // Clean orphaned data
    const cleanTables = [
      "chat_messages", "order_items", "order_status_history", "orders",
      "cart_items", "product_reviews", "product_addons", "product_specifications",
      "products", "seller_availability_slots", "seller_contact_interactions",
      "seller_profiles", "delivery_addresses", "notifications",
      "collective_buy_participants", "collective_buy_requests",
      "coupon_redemptions", "coupons", "call_feedback",
    ];
    for (const table of cleanTables) {
      try {
        const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) console.warn(`Clean ${table}: ${error.message}`);
      } catch (_) { /* table may not exist */ }
    }

    // Clean profiles (except admin)
    if (adminIds.length > 0) {
      await supabase.from("profiles").delete().not("id", "in", `(${adminIds.join(",")})`);
    }

    // ── Step 2: Enable auto-approval settings ─────────────────────
    const autoSettings = [
      { key: "auto_approve_sellers", value: "true", description: "Auto-approve new seller registrations" },
      { key: "auto_approve_products", value: "true", description: "Auto-approve new product listings" },
    ];
    for (const s of autoSettings) {
      await supabase.from("admin_settings").upsert(
        { key: s.key, value: s.value, description: s.description, is_active: true },
        { onConflict: "key" }
      );
    }
    console.log("Auto-approval settings enabled");

    // ── Step 3: Create test sellers ───────────────────────────────
    const createdSellers: any[] = [];

    for (const seller of TEST_SELLERS) {
      // Create auth user with phone
      const syntheticEmail = `${seller.phone}@phone.sociva.app`;
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        phone: seller.phone,
        email: syntheticEmail,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { name: seller.name, phone: seller.phone },
      });
      if (authErr) {
        console.error(`Auth create failed for ${seller.phone}: ${authErr.message}`);
        continue;
      }
      const uid = authData.user!.id;
      console.log(`Created user ${seller.name} (${uid})`);

      // Upsert profile
      const { error: profErr } = await supabase.from("profiles").upsert({
        id: uid,
        name: seller.name,
        email: seller.email,
        phone: seller.phone,
        flat_number: seller.flat_number,
        block: seller.block,
        society_id: SOCIETY_ID,
        verification_status: "approved",
      }, { onConflict: "id" });
      if (profErr) console.error(`Profile error: ${profErr.message}`);

      // Create seller profile
      const { data: sellerData, error: sellerErr } = await supabase.from("seller_profiles").insert({
        user_id: uid,
        business_name: seller.store_name,
        description: seller.store_description,
        seller_type: "society_resident",
        society_id: SOCIETY_ID,
        latitude: seller.latitude,
        longitude: seller.longitude,
        categories: seller.categories,
        verification_status: "approved",
        is_available: true,
        sell_beyond_community: true,
        delivery_radius_km: 5,
      }).select("id").single();

      if (sellerErr) {
        console.error(`Seller profile error for ${seller.store_name}: ${sellerErr.message}`);
        continue;
      }
      const sellerId = sellerData!.id;
      console.log(`Created seller ${seller.store_name} (${sellerId})`);

      // Create products
      let productCount = 0;
      for (const prod of seller.products) {
        const { error: prodErr } = await supabase.from("products").insert({
          seller_id: sellerId,
          name: prod.name,
          description: prod.description,
          price: prod.price,
          category: prod.category,
          is_veg: prod.is_veg,
          is_available: true,
          approval_status: "approved",
          society_id: SOCIETY_ID,
        });
        if (prodErr) {
          console.error(`Product error (${prod.name}): ${prodErr.message}`);
        } else {
          productCount++;
        }
      }

      createdSellers.push({
        name: seller.store_name,
        phone: seller.phone,
        seller_id: sellerId,
        user_id: uid,
        products_created: productCount,
        categories: seller.categories,
      });
    }

    // ── Step 4: Update seller discovery index ─────────────────────
    try {
      for (const s of createdSellers) {
        await supabase.from("seller_discovery_index").upsert({
          seller_id: s.seller_id,
          latitude: TEST_SELLERS.find(t => t.phone === s.phone)!.latitude,
          longitude: TEST_SELLERS.find(t => t.phone === s.phone)!.longitude,
          is_active: true,
          is_approved: true,
          has_products: true,
          discovery_radius_km: 5,
        }, { onConflict: "seller_id" });
      }
      console.log("Discovery index updated");
    } catch (e) {
      console.warn("Discovery index update skipped:", e.message);
    }

    const duration = Date.now() - start;
    return new Response(
      JSON.stringify({
        success: true,
        duration_ms: duration,
        purged_users: deletedCount,
        admins_preserved: adminIds.length,
        sellers: createdSellers,
        auto_approval: true,
        society: "Shriram Greenfield",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Setup error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message, duration_ms: Date.now() - start }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
