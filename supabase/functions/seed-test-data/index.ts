import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // C4: Block in production unless explicitly allowed
    if (!Deno.env.get("ALLOW_TEST_FUNCTIONS")) {
      return new Response(
        JSON.stringify({ error: "Test functions are disabled in this environment" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limit — 5 per hour (uses IP since this may not have auth)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed } = await checkRateLimit(`seed:${clientIp}`, 5, 3600);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const password = "Test@12345";

    // --- Step 1: Create 3 societies ---
    const societies = [
      {
        name: "Green Valley Residency",
        slug: "green-valley-residency",
        address: "MG Road, Central Bangalore",
        city: "Bangalore",
        state: "Karnataka",
        pincode: "560001",
        latitude: 12.9716,
        longitude: 77.5946,
        is_active: true,
        is_verified: true,
        member_count: 0,
        geofence_radius_meters: 500,
        approval_method: "auto",
        auto_approve_residents: true,
        max_society_admins: 5,
      },
      {
        name: "Lakeside Towers",
        slug: "lakeside-towers",
        address: "Indiranagar, Bangalore",
        city: "Bangalore",
        state: "Karnataka",
        pincode: "560038",
        latitude: 12.995,
        longitude: 77.615,
        is_active: true,
        is_verified: true,
        member_count: 0,
        geofence_radius_meters: 500,
        approval_method: "auto",
        auto_approve_residents: true,
        max_society_admins: 5,
      },
      {
        name: "Hilltop Heights",
        slug: "hilltop-heights",
        address: "Whitefield, Bangalore",
        city: "Bangalore",
        state: "Karnataka",
        pincode: "560066",
        latitude: 13.035,
        longitude: 77.65,
        is_active: true,
        is_verified: true,
        member_count: 0,
        geofence_radius_meters: 500,
        approval_method: "auto",
        auto_approve_residents: true,
        max_society_admins: 5,
      },
    ];

    const { data: societyRows, error: socErr } = await supabase
      .from("societies")
      .insert(societies)
      .select("id, name, slug");

    if (socErr) throw new Error(`Society insert failed: ${socErr.message}`);

    const societyB = societyRows![0]; // Green Valley
    const societyD = societyRows![1]; // Lakeside
    const societyE = societyRows![2]; // Hilltop

    // --- Step 2: Create auth users ---
    const usersToCreate = [
      { email: "usera@test.sociva.com", name: "User A (Buyer)", society: societyB },
      { email: "userd@test.sociva.com", name: "User D (Buyer)", society: societyD },
      { email: "sellerc@test.sociva.com", name: "Seller C (Food)", society: societyB },
      { email: "sellere@test.sociva.com", name: "Seller E (Food)", society: societyE },
    ];

    const createdUsers: Record<string, { id: string; email: string; societyId: string }> = {};

    for (const u of usersToCreate) {
      const { data: authData, error: authErr } =
        await supabase.auth.admin.createUser({
          email: u.email,
          password,
          email_confirm: true,
          user_metadata: { name: u.name },
        });

      if (authErr) throw new Error(`Auth create failed for ${u.email}: ${authErr.message}`);

      createdUsers[u.email] = {
        id: authData.user.id,
        email: u.email,
        societyId: u.society.id,
      };
    }

    const userA = createdUsers["usera@test.sociva.com"];
    const userD = createdUsers["userd@test.sociva.com"];
    const sellerC = createdUsers["sellerc@test.sociva.com"];
    const sellerE = createdUsers["sellere@test.sociva.com"];

    // --- Step 3: Create profiles ---
    const profiles = [
      { id: userA.id, phone: "9100000001", name: "User A", flat_number: "A-101", block: "A", society_id: userA.societyId, verification_status: "approved" },
      { id: userD.id, phone: "9100000002", name: "User D", flat_number: "B-201", block: "B", society_id: userD.societyId, verification_status: "approved" },
      { id: sellerC.id, phone: "9100000003", name: "Seller C", flat_number: "C-301", block: "C", society_id: sellerC.societyId, verification_status: "approved" },
      { id: sellerE.id, phone: "9100000004", name: "Seller E", flat_number: "D-401", block: "D", society_id: sellerE.societyId, verification_status: "approved" },
    ];

    const { error: profErr } = await supabase.from("profiles").insert(profiles);
    if (profErr) throw new Error(`Profile insert failed: ${profErr.message}`);

    // --- Step 3b: Create user roles ---
    const roles = [
      { user_id: userA.id, role: "buyer" },
      { user_id: userD.id, role: "buyer" },
      { user_id: sellerC.id, role: "seller" },
      { user_id: sellerE.id, role: "seller" },
    ];

    const { error: roleErr } = await supabase.from("user_roles").insert(roles);
    if (roleErr) throw new Error(`Role insert failed: ${roleErr.message}`);

    // --- Step 4: Create seller profiles ---
    const sellerProfiles = [
      {
        user_id: sellerC.id,
        business_name: "Seller C Kitchen",
        description: "Authentic home-cooked food from Society B",
        categories: ["home_food", "bakery"],
        primary_group: "food",
        is_available: true,
        accepts_cod: true,
        accepts_upi: true,
        verification_status: "approved",
        society_id: sellerC.societyId,
        sell_beyond_community: true,
        delivery_radius_km: 5,
        operating_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        rating: 4.5,
        total_reviews: 0,
      },
      {
        user_id: sellerE.id,
        business_name: "Seller E Cafe",
        description: "South Indian specialties from Society E",
        categories: ["home_food"],
        primary_group: "food",
        is_available: true,
        accepts_cod: true,
        accepts_upi: true,
        verification_status: "approved",
        society_id: sellerE.societyId,
        sell_beyond_community: true,
        delivery_radius_km: 10,
        operating_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        rating: 4.2,
        total_reviews: 0,
      },
    ];

    const { data: sellerRows, error: sellerErr } = await supabase
      .from("seller_profiles")
      .insert(sellerProfiles)
      .select("id, user_id, business_name");

    if (sellerErr) throw new Error(`Seller insert failed: ${sellerErr.message}`);

    const sellerCProfile = sellerRows![0];
    const sellerEProfile = sellerRows![1];

    // --- Step 5: Create products ---
    const productsList = [
      { seller_id: sellerCProfile.id, name: "Butter Chicken", description: "Rich creamy butter chicken", price: 250, category: "home_food", is_veg: false, is_available: true, is_bestseller: true, is_recommended: true, is_urgent: false, action_type: "add_to_cart", approval_status: "approved" },
      { seller_id: sellerCProfile.id, name: "Paneer Tikka", description: "Smoky grilled paneer tikka", price: 180, category: "home_food", is_veg: true, is_available: true, is_bestseller: false, is_recommended: true, is_urgent: false, action_type: "add_to_cart", approval_status: "approved" },
      { seller_id: sellerCProfile.id, name: "Fresh Naan", description: "Soft fresh tandoori naan", price: 30, category: "bakery", is_veg: true, is_available: true, is_bestseller: false, is_recommended: false, is_urgent: false, action_type: "add_to_cart", approval_status: "approved" },
      { seller_id: sellerEProfile.id, name: "Masala Dosa", description: "Crispy masala dosa with chutney", price: 80, category: "home_food", is_veg: true, is_available: true, is_bestseller: true, is_recommended: true, is_urgent: false, action_type: "add_to_cart", approval_status: "approved" },
      { seller_id: sellerEProfile.id, name: "Filter Coffee", description: "Traditional South Indian filter coffee", price: 40, category: "home_food", is_veg: true, is_available: true, is_bestseller: false, is_recommended: true, is_urgent: false, action_type: "add_to_cart", approval_status: "approved" },
    ];

    const { data: productRows, error: prodErr } = await supabase
      .from("products")
      .insert(productsList)
      .select("id, name, seller_id");

    if (prodErr) throw new Error(`Product insert failed: ${prodErr.message}`);

    // --- Return summary ---
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          societies: {
            B: { id: societyB.id, name: societyB.name },
            D: { id: societyD.id, name: societyD.name },
            E: { id: societyE.id, name: societyE.name },
          },
          users: {
            userA: { email: userA.email, id: userA.id, society: "B" },
            userD: { email: userD.email, id: userD.id, society: "D" },
            sellerC: { email: sellerC.email, id: sellerC.id, society: "B" },
            sellerE: { email: sellerE.email, id: sellerE.id, society: "E" },
          },
          sellers: sellerRows,
          products: productRows,
          credentials: { password },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
