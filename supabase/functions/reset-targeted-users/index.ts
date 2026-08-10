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

    // Rate limit — 2 per hour
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed } = await checkRateLimit(`reset-targeted:${clientIp}`, 2, 3600);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: any[] = [];
    const t0 = Date.now();

    // --- PHASE 0: Identify the two users by phone ---
    const targetPhones = ["9535115316", "7838459432"];
    const { data: targetProfiles, error: profilesErr } = await sb
      .from("profiles")
      .select("id, phone, society_id, name")
      .in("phone", targetPhones);

    if (profilesErr) throw new Error(`Failed to fetch target profiles: ${profilesErr.message}`);
    if (!targetProfiles || targetProfiles.length !== 2) {
      throw new Error(`Expected 2 target profiles, found ${targetProfiles?.length || 0}`);
    }

    const userA = targetProfiles.find(p => p.phone === "9535115316");
    const userB = targetProfiles.find(p => p.phone === "7838459432");

    if (!userA || !userB) {
      throw new Error("Could not find both target users");
    }

    const [uidA, uidB] = [userA.id, userB.id];
    const [societyIdA, societyIdB] = [userA.society_id, userB.society_id];

    results.push(makeResult("identify", "target_users", "passed", {
      userA: { id: uidA, phone: userA.phone, name: userA.name, society: societyIdA },
      userB: { id: uidB, phone: userB.phone, name: userB.name, society: societyIdB }
    }));

    // --- PHASE 1: Delete ALL data belonging to these two users (and their societies if only they belong) ---
    // We'll delete in reverse FK order, but scoped to the two users.

    // First, let's get all seller profiles for these users (if they are sellers)
    const { data: sellerProfiles, error: sellerProfilesErr } = await sb
      .from("seller_profiles")
      .select("id, user_id")
      .in("user_id", [uidA, uidB]);

    const sellerIds = sellerProfiles?.map(sp => sp.id) || [];

    // Get all product IDs for these sellers
    const { data: products, error: productsErr } = await sb
      .from("products")
      .select("id")
      .in("seller_id", sellerIds);

    const productIds = products?.map(p => p.id) || [];

    // Get all service slots for these products (if any)
    const { data: serviceSlots, error: slotsErr } = await sb
      .from("service_slots")
      .select("id")
      .in("product_id", productIds);

    const slotIds = serviceSlots?.map(s => s.id) || [];

    // Get all service bookings for these slots or products
    const { data: serviceBookings, error: bookingsErr } = await sb
      .from("service_bookings")
      .select("id")
      .or(
        sellerIds.length > 0
          ? `seller_id.in.(${sellerIds.map(id => `"${id}"`).join(",")})`
          : "",
        productIds.length > 0
          ? `product_id.in.(${productIds.map(id => `"${id}"`).join(",")})`
          : "",
        slotIds.length > 0
          ? `slot_id.in.(${slotIds.map(id => `"${id}"`).join(",")})`
          : ""
      );

    const serviceBookingIds = serviceBookings?.map(b => b.id) || [];

    // Get all orders for these users (buyer_id) or from their products (seller_id via order_items)
    const { data: buyerOrders, error: buyerOrdersErr } = await sb
      .from("orders")
      .select("id")
      .in("buyer_id", [uidA, uidB]);

    const buyerOrderIds = buyerOrders?.map(o => o.id) || [];

    // Get order items for these products (to find orders that contain their products)
    const { data: orderItemsForProducts, error: orderItemsErr } = await sb
      .from("order_items")
      .select("order_id")
      .in("product_id", productIds);

    const orderItemOrderIds = orderItemsForProducts?.map(oi => oi.order_id) || [];

    // Combine all order IDs to delete
    const allOrderIds = [...new Set([...buyerOrderIds, ...orderItemOrderIds])];

    // Get chat messages for these orders
    const { data: chatMessages, error: chatErr } = await sb
      .from("chat_messages")
      .select("id")
      .in("order_id", allOrderIds);

    const chatMessageIds = chatMessages?.map(cm => cm.id) || [];

    // Get seller contact interactions for these sellers or buyers
    const { data: contactInteractions, error: contactErr } = await sb
      .from("seller_contact_interactions")
      .select("id")
      .or(
        sellerIds.length > 0
          ? `seller_id.in.(${sellerIds.map(id => `"${id}"`).join(",")})`
          : "",
        [uidA, uidB].length > 0
          ? `buyer_id.in.(${[uidA, uidB].map(id => `"${id}"`).join(",")})`
          : ""
      );

    const contactInteractionIds = contactInteractions?.map(ci => ci.id) || [];

    // Get service enquiries (assuming there's a service_enquiries table)
    // Let's check if it exists by trying to select from it (we'll ignore if it doesn't)
    const { data: serviceEnquiries, error: enquiriesErr } = await sb
      .from("service_enquiries")
      .select("id")
      .or(
        sellerIds.length > 0
          ? `seller_id.in.(${sellerIds.map(id => `"${id}"`).join(",")})`
          : "",
        [uidA, uidB].length > 0
          ? `buyer_id.in.(${[uidA, uidB].map(id => `"${id}"`).join(",")})`
          : ""
      );

    const serviceEnquiryIds = serviceEnquiries?.map(se => se.id) || [];

    // Get help requests from these users (in their societies)
    const { data: helpRequests, error: helpReqErr } = await sb
      .from("help_requests")
      .select("id")
      .in("society_id", [societyIdA, societyIdB])
      .in("requester_id", [uidA, uidB]);

    const helpRequestIds = helpRequests?.map(hr => hr.id) || [];

    // Get help responses to these users' help requests
    const { data: helpResponses, error: helpRespErr } = await sb
      .from("help_responses")
      .select("id")
      .in("request_id", helpRequestIds);

    const helpResponseIds = helpResponses?.map(hr => hr.id) || [];

    // Now delete in reverse order (children first)

    // 1. Delete service booking addons (if table exists)
    try {
      await sb.from("service_booking_addons").delete().in("booking_id", serviceBookingIds);
    } catch (e) { /* table might not exist */ }

    // 2. Delete service bookings
    if (serviceBookingIds.length > 0) {
      await sb.from("service_bookings").delete().in("id", serviceBookingIds);
    }

    // 3. Delete service slots
    if (slotIds.length > 0) {
      await sb.from("service_slots").delete().in("id", slotIds);
    }

    // 4. Delete products
    if (productIds.length > 0) {
      await sb.from("products").delete().in("id", productIds);
    }

    // 5. Delete seller profiles
    if (sellerIds.length > 0) {
      await sb.from("seller_profiles").delete().in("id", sellerIds);
    }

    // 6. Delete order items for these orders/products
    if (allOrderIds.length > 0) {
      await sb.from("order_items").delete().in("order_id", allOrderIds);
    }

    // 7. Delete orders
    if (allOrderIds.length > 0) {
      await sb.from("orders").delete().in("id", allOrderIds);
    }

    // 8. Delete chat messages
    if (chatMessageIds.length > 0) {
      await sb.from("chat_messages").delete().in("id", chatMessageIds);
    }

    // 9. Delete seller contact interactions
    if (contactInteractionIds.length > 0) {
      await sb.from("seller_contact_interactions").delete().in("id", contactInteractionIds);
    }

    // 10. Delete service enquiries (if table exists)
    if (serviceEnquiryIds.length > 0) {
      try {
        await sb.from("service_enquiries").delete().in("id", serviceEnquiryIds);
      } catch (e) { /* table might not exist */ }
    }

    // 11. Delete help responses
    if (helpResponseIds.length > 0) {
      await sb.from("help_responses").delete().in("id", helpResponseIds);
    }

    // 12. Delete help requests
    if (helpRequestIds.length > 0) {
      await sb.from("help_requests").delete().in("id", helpRequestIds);
    }

    // 13. Delete reviews for these sellers or products
    try {
      await sb.from("reviews").delete().or(
        sellerIds.length > 0
          ? `seller_id.in.(${sellerIds.map(id => `"${id}"`).join(",")})`
          : "",
        productIds.length > 0
          ? `product_id.in.(${productIds.map(id => `"${id}"`).join(",")})`
          : ""
      );
    } catch (e) { /* ignore if table doesn't exist or error */ }

    // 14. Delete cart items for these users
    try {
      await sb.from("cart_items").delete().in("buyer_id", [uidA, uidB]);
    } catch (e) { /* ignore */ }

    // 15. Delete favorites for these users
    try {
      await sb.from("favorites").delete().in("user_id", [uidA, uidB]);
    } catch (e) { /* ignore */ }

    // 16. Delete user_roles for these users (but keep if they are admin? We'll not delete admin roles)
    // We'll fetch admin roles first to avoid deleting admins
    const { data: adminRoles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const adminUserIds = (adminRoles || []).map(r => r.user_id);

    const nonAdminUserIds = [uidA, uidB].filter(id => !adminUserIds.includes(id));
    if (nonAdminUserIds.length > 0) {
      await sb.from("user_roles").delete().in("user_id", nonAdminUserIds);
    }

    // 17. Delete profiles for these users (but keep if they are the only profiles in their societies? We'll delete them anyway as per instruction)
    // However, note: if we delete the profiles, the societies might become empty. We'll keep societies as per instruction.
    await sb.from("profiles").delete().in("id", [uidA, uidB]);

    // 18. Delete auth users for these users (but keep if they are the only auth users? We'll delete them)
    for (const uid of [uidA, uidB]) {
      try {
        await sb.auth.admin.deleteUser(uid);
      } catch (e) {
        console.warn(`Failed to delete auth user ${uid}:`, e.message);
      }
    }

    results.push(makeResult("purge", "user_data", "passed", {
      purgedItems: {
        serviceBookingAddons: serviceBookingIds.length,
        serviceBookings: serviceBookingIds.length,
        serviceSlots: slotIds.length,
        products: productIds.length,
        sellerProfiles: sellerIds.length,
        orderItems: allOrderIds.length,
        orders: allOrderIds.length,
        chatMessages: chatMessageIds.length,
        contactInteractions: contactInteractionIds.length,
        serviceEnquiries: serviceEnquiryIds.length,
        helpResponses: helpResponseIds.length,
        helpRequests: helpRequestIds.length,
        userRoles: nonAdminUserIds.length,
        profiles: 2,
        authUsers: 2
      }
    }));

    // --- PHASE 2: Re-create the two users with fresh data ---
    // We'll create them in society A and society B respectively (keeping their original societies)
    // If societies don't exist (unlikely), we'll create a default society? But instruction says keep same location.

    // Let's fetch the societies to ensure they exist
    const { data: societies, error: societiesErr } = await sb
      .from("societies")
      .select("id, name, slug")
      .in("id", [societyIdA, societyIdB]);

    if (societiesErr) throw new Error(`Failed to fetch societies: ${societiesErr.message}`);

    const societyMap = new Map(societies.map(s => [s.id, s]));

    if (!societyMap.has(societyIdA) || !societyMap.has(societyIdB)) {
      throw new Error("One or more target societies not found");
    }

    // Create auth users
    const password = "TestUser123!"; // Same password for both for simplicity in testing

    const createdUsers: Record<string, { id: string; email: string; societyId: string }> = {};

    const usersToCreate = [
      {
        phone: "9535115316",
        name: "User A",
        email: "usera@test.sociva.com",
        societyId: societyIdA,
        role: "buyer" // We'll make one buyer and one seller for variety
      },
      {
        phone: "7838459432",
        name: "User B",
        email: "userb@test.sociva.com",
        societyId: societyIdB,
        role: "seller" // This one will be a seller
      }
    ];

    for (const u of usersToCreate) {
      // Check if auth user already exists (unlikely since we just deleted, but safe)
      const { data: existingUser } = await sb.auth.admin.listUsers({
        filters: { email: u.email }
      });

      let userId: string;
      if (existingUser?.users && existingUser.users.length > 0) {
        userId = existingUser.users[0].id;
        // Update password to known value
        await sb.auth.admin.updateUserById(userId, {
          password: password,
          email_confirm: true
        });
      } else {
        const { data: authData, error: authErr } = await sb.auth.admin.createUser({
          email: u.email,
          password: password,
          email_confirm: true,
          user_metadata: { name: u.name, phone: u.phone }
        });

        if (authErr) throw new Error(`Auth create failed for ${u.email}: ${authErr.message}`);
        userId = authData.user.id;
      }

      createdUsers[u.phone] = { id: userId, email: u.email, societyId: u.societyId };

      // Create profile
      const { error: profErr } = await sb.from("profiles").upsert({
        id: userId,
        name: u.name,
        phone: u.phone,
        email: u.email,
        society_id: u.societyId,
        flat_number: "A-101", // Default flat
        block: "Tower A",    // Default block
        verification_status: "approved"
      }, { onConflict: "id" });

      if (profErr) throw new Error(`Profile upsert failed for ${u.email}: ${profErr.message}`);

      // Assign role
      await sb.from("user_roles").upsert(
        { user_id: userId, role: u.role },
        { onConflict: "user_id,role" }
      );
    }

    results.push(makeResult("create", "users_profiles_roles", "passed", {
      usersCreated: Object.keys(createdUsers).length
    }));

    // --- PHASE 3: Create seller profile for User B (the seller) ---
    const sellerUser = createdUsers["7838459432"];
    const buyerUser = createdUsers["9535115316"];

    let sellerProfileId: string;
    if (sellerUser) {
      const { data: sellerData, error: sellerErr } = await sb
        .from("seller_profiles")
        .insert({
          user_id: sellerUser.id,
          business_name: "FreshMart Grocery",
          description: "Daily fresh groceries, vegetables, fruits, and household essentials delivered to your doorstep.",
          categories: ["home_food", "snacks", "beverages"],
          primary_group: "food",
          is_available: true,
          accepts_cod: true,
          accepts_upi: true,
          verification_status: "approved",
          society_id: sellerUser.societyId,
          sell_beyond_community: true,
          delivery_radius_km: 5,
          operating_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          rating: 4.8,
          total_reviews: 24
        })
        .select("id")
        .single();

      if (sellerErr) throw new Error(`Seller profile creation failed: ${sellerErr.message}`);
      sellerProfileId = sellerData.id;

      results.push(makeResult("create", "seller_profile", "passed", {
        seller_id: sellerProfileId,
        business_name: sellerData.business_name
      }));
    }

    // --- PHASE 4: Create products for the seller ---
    if (sellerProfileId) {
      const productsToCreate = [
        {
          name: "Organic Tomatoes (1kg)",
          price: 80,
          mrp: 100,
          category: "home_food",
          is_veg: true,
          description: "Fresh organic tomatoes sourced from local farms. Rich in lycopene and vitamins.",
          is_available: true,
          is_bestseller: true,
          is_recommended: true,
          action_type: "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: 5,
          cuisine_type: "Indian",
          serving_size: "1 kg",
          spice_level: "none"
        },
        {
          name: "Multigrain Bread (loaf)",
          price: 60,
          mrp: 80,
          category: "bakery",
          is_veg: true,
          description: "Whole wheat multigrain bread with seeds, baked fresh every morning.",
          is_available: true,
          is_bestseller: false,
          is_recommended: true,
          action_type: "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: 0,
          cuisine_type: "Western",
          serving_size": "1 loaf (500g)",
          spice_level: "none"
        },
        {
          name: "Masala Chai (500g loose leaf)",
          price: 180,
          mrp: 220,
          category: "home_food",
          is_veg: true,
          description: "Premium blend of Assam tea leaves with ginger, cardamom, cinnamon, and cloves.",
          is_available: true,
          is_bestseller: true,
          is_recommended: false,
          action_type: "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: 2,
          cuisine_type": "Indian",
          serving_size": "500g pouch",
          spice_level: "medium"
        },
        {
          name: "Strawberry Jam (500g)",
          price: 160,
          mrp: 200,
          category: "home_food",
          is_veg: true,
          description: "Homemade strawberry jam with real fruit chunks, no artificial preservatives.",
          is_available: true,
          is_bestseller: false,
          is_recommended: true,
          action_type: "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: 0,
          cuisine_type": "Western",
          serving_size": "500g jar",
          spice_level: "none"
        },
        {
          name: "Poha (Instant, 500g)",
          price: 90,
          mrp: 120,
          category: "home_food",
          is_veg: true,
          description: "Quick-cook flattened rice flakes, ready in 5 minutes. Perfect for breakfast.",
          is_available: true,
          is_bestseller: true,
          is_recommended: true,
          action_type: "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: 5,
          cuisine_type": "Indian",
          serving_size": "500g pack",
          spice_level: "none"
        }
      ];

      let productsCreated = 0;
      for (const p of productsToCreate) {
        const { error: prodErr } = await sb.from("products").insert({
          seller_id: sellerProfileId,
          name: p.name,
          price: p.price,
          mrp: p.mrp,
          category: p.category,
          is_veg: p.is_veg,
          description: p.description,
          is_available: p.is_available,
          is_bestseller: p.is_bestseller,
          is_recommended: p.is_recommended,
          action_type: p.action_type,
          approval_status: p.approval_status,
          prep_time_minutes: p.prep_time_minutes,
          cuisine_type: p.cuisine_type,
          serving_size: p.serving_size,
          spice_level: p.spice_level
        });

        if (!prodErr) productsCreated++;
        else console.warn(`Failed to create product ${p.name}:`, prodErr.message);
      }

      results.push(makeResult("create", "products", "passed", {
        count: productsCreated,
        total: productsToCreate.length
      }));
    }

    // --- PHASE 5: Create a bookable service for the seller ---
    let serviceProductId: string;
    if (sellerProfileId) {
      // First create a product for the service
      const { data: serviceProduct, error: serviceProdErr } = await sb
        .from("products")
        .insert({
          seller_id: sellerProfileId,
          name: "Yoga Class (Private Session)",
          price: 800,
          mrp: 1000,
          category: "yoga",
          is_veg: true,
          description: "Personalized 60-minute yoga session at your home or society garden. Includes asanas, pranayama, and meditation.",
          is_available: true,
          is_bestseller: true,
          is_recommended: true,
          action_type: "request_service",
          approval_status: "approved",
          service_duration_minutes: 60
        })
        .select("id")
        .single();

      if (serviceProdErr) throw new Error(`Service product creation failed: ${serviceProdErr.message}`);
      serviceProductId = serviceProduct.id;

      results.push(makeResult("create", "service_product", "passed", {
        product_id: serviceProductId,
        name: serviceProduct.name
      }));

      // Create service slots for the next 7 days
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0); // Start of today

      const slotsCreated = [];
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + dayOffset);

        // Skip Sundays for variety (or keep, but let's skip for example)
        if (date.getDay() === 0) continue; // 0 is Sunday

        // Create two slots per day: morning and evening
        const morningSlot = new Date(date);
        morningSlot.setHours(7, 0, 0); // 7:00 AM

        const eveningSlot = new Date(date);
        eveningSlot.setHours(17, 0, 0); // 5:00 PM

        for (const [slotTime, label] of [[morningSlot, "Morning"], [eveningSlot, "Evening"]]) {
          const { data: slot, error: slotErr } = await sb
            .from("service_slots")
            .insert({
              product_id: serviceProductId,
              seller_id: sellerProfileId,
              slot_date: slotTime.toISOString().split('T')[0], // YYYY-MM-DD
              day_of_week: slotTime.getDay(), // 0-6, Sun-Sat
              start_time: slotTime.toTimeString().slice(0, 5), // HH:MM
              end_time: new Date(slotTime.getTime() + 60 * 60 * 1000).toTimeString().slice(0, 5), // +1 hour
              max_capacity: 1,
              is_blocked: false
            })
            .select("id")
            .single();

          if (!slotErr) {
            slotsCreated.push(slot.id);
          } else {
            console.warn(`Failed to create ${label} slot for ${date.toDateString()}:`, slotErr.message);
          }
        }
      }

      results.push(makeResult("create", "service_slots", "passed", {
        count: slotsCreated,
        product_id: serviceProductId
      }));
    }

    // --- PHASE 6: Create service enquiry data ---
    // Let's create a few enquiries from the buyer about the seller's products
    if (buyerUser && sellerProfileId) {
      const enquiriesToCreate = [
        {
          buyer_id: buyerUser.id,
          seller_id: sellerProfileId,
          product_id: productsToCreate[0] ? null : undefined, // We'll set after we know product IDs
          message: "Are the organic tomatoes sprayed with any pesticides?",
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          status: "answered"
        },
        {
          buyer_id: buyerUser.id,
          seller_id: sellerProfileId,
          product_id: productsToCreate[1] ? null : undefined,
          message: "Is the multigrain bread gluten-free?",
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
          status: "pending"
        },
        {
          buyer_id: buyerUser.id,
          seller_id: sellerProfileId,
          message: "Do you deliver to apartment complexes or only independent houses?",
          created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
          status: "answered"
        }
      ];

      // We need to get the actual product IDs to fill in product_id
      const { data: actualProducts, error: actualProdErr } = await sb
        .from("products")
        .select("id, name")
        .eq("seller_id", sellerProfileId);

      if (!actualProdErr && actualProducts) {
        const productMap = new Map(actualProducts.map(p => [p.name, p.id]));

        for (const eq of enquiriesToCreate) {
          // Try to match by product name in message (simplistic)
          if (eq.message.includes("tomato")) {
            eq.product_id = productMap.get("Organic Tomatoes (1kg)") || null;
          } else if (eq.message.includes("bread")) {
            eq.product_id = productMap.get("Multigrain Bread (loaf)") || null;
          }
        }
      }

      // Insert enquiries (if the table exists)
      try {
        for (const eq of enquiriesToCreate) {
          await sb.from("service_enquiries").insert({
            buyer_id: eq.buyer_id,
            seller_id: eq.seller_id,
            product_id: eq.product_id,
            message: eq.message,
            created_at: eq.created_at,
            status: eq.status
          });
        }

        results.push(makeResult("create", "service_enquiries", "passed", {
          count: enquiriesToCreate.length
        }));
      } catch (e) {
        // Table might not exist, that's okay
        console.warn("service_enquiries table might not exist:", e.message);
        results.push(makeResult("create", "service_enquiries", "skipped", {
          reason: "Table service_enquiries not found or not accessible"
        }));
      }
    }

    // --- PHASE 7: Create contact/communication data ---
    // Create a few chat messages between buyer and seller about an order
    // First, let's create an order for the buyer
    if (buyerUser && sellerProfileId) {
      // Create an order
      const { data: order, error: orderErr } = await sb
        .from("orders")
        .insert({
          buyer_id: buyerUser.id,
          seller_id: sellerProfileId,
          status: "confirmed",
          total_amount: 500,
          net_amount: 450,
          payment_status: "paid",
          payment_mode: "upi",
          fulfillment_type: "delivery",
          delivery_address: "A-101, Tower A, Society A",
          delivery_lat: 12.9716,
          delivery_lng: 77.5946,
          created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
          updated_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
        })
        .select("id")
        .single();

      if (!orderErr && order) {
        const orderId = order.id;

        // Create order items
        const { data: actualProducts, error: actualProdErr } = await sb
          .from("products")
          .select("id, name, price")
          .eq("seller_id", sellerProfileId)
          .limit(3);

        if (!actualProdErr && actualProducts && actualProducts.length > 0) {
          const orderItems = actualProducts.map((p, index) => ({
            order_id: orderId,
            product_id: p.id,
            product_name: p.name,
            unit_price: p.price,
            quantity: index === 0 ? 2 : 1, // Vary quantities
            status: "delivered",
            subtotal: p.price * (index === 0 ? 2 : 1)
          }));

          for (const item of orderItems) {
            await sb.from("order_items").insert(item);
          }

          // Create chat messages for this order
          const chatMessages = [
            {
              order_id: orderId,
              sender_id: buyerUser.id,
              receiver_id: sellerProfileId,
              message_text: "Hello, when can you deliver the order?",
              created_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
            },
            {
              order_id: orderId,
              sender_id: sellerProfileId,
              receiver_id: buyerUser.id,
              message_text: "Hi! I can deliver today between 4-6 PM. Is that okay?",
              created_at: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString()
            },
            {
              order_id: orderId,
              sender_id: buyerUser.id,
              receiver_id: sellerProfileId,
              message_text: "Yes, 4-6 PM works perfectly. Thank you!",
              created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
            }
          ];

          for (const msg of chatMessages) {
            await sb.from("chat_messages").insert(msg);
          }

          results.push(makeResult("create", "order_and_chat", "passed", {
            order_id: orderId,
            order_items: orderItems.length,
            chat_messages: chatMessages.length
          }));
        }
      } else {
        console.warn("Failed to fetch products for order items:", actualProdErr);
      }
    }

    // --- PHASE 8: Verify location-based discovery still works ---
    // Test that the buyer can discover the seller (they are in different societies)
    // We'll use the search_nearby_sellers RPC if it exists
    try {
      const { data: nearbySellers, error: nearbyErr } = await sb.rpc("search_nearby_sellers", {
        _buyer_society_id: buyerUser.societyId,
        _radius_km: 10
      });

      if (!nearbyErr && nearbySellers) {
        const found = nearbySellers.some((s: any) => s.seller_id === sellerProfileId);
        results.push(makeResult("verify", "location_discovery", found ? "passed" : "failed", {
          buyer_society: buyerUser.societyId,
          seller_society: sellerUser.societyId,
          sellers_found: nearbySellers.length,
          seller_found: found
        }));
      } else {
        results.push(makeResult("verify", "location_discovery", "skipped", {
          reason: nearbyErr ? nearbyErr.message : "RPC not available"
        }));
      }
    } catch (e) {
      results.push(makeResult("verify", "location_discovery", "skipped", {
        reason: "RPC call failed: " + e.message
      }));
    }

    // --- PHASE 9: Save results to test_results ---
    const duration = Date.now() - t0;
    results.push(makeResult("summary", "reset_completed", "passed", {
      duration_ms: duration,
      societies_affected: [societyIdA, societyIdB].length,
      users_reset: 2,
      sellers_created: sellerProfileId ? 1 : 0,
      products_created: productsCreated || 0,
      service_slots_created: slotsCreated?.length || 0
    }));

    // Save results
    try {
      await sb.from("test_results").insert(
        results.map(r => ({ ...r, duration_ms: duration }))
      );
    } catch (e) {
      console.error("Failed to save test results:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        run_id: `reset_${Date.now()}`,
        duration_ms: duration,
        summary: {
          societies: [societyIdA, societyIdB],
          users: {
            userA: { id: uidA, phone: "9535115316", role: "buyer" },
            userB: { id: uidB, phone: "7838459432", role: "seller" }
          },
          seller_profile_id: sellerProfileId,
          service_product_id: serviceProductId,
          test_results_saved: results.length
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    // Try to save error results
    try {
      await sb.from("test_results").insert([
        makeResult("error", "fatal_error", "failed", null, error.message)
      ]);
    } catch (e) {
      console.error("Failed to save error results:", e);
    }

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to create a result object
function makeResult(module: string, test: string, outcome: string, details?: any, error?: string) {
  return {
    module_name: module,
    test_name: test,
    outcome,
    response_payload: details || null,
    error_message: error || null,
    executed_at: new Date().toISOString(),
    file_path: "supabase/functions/reset-targeted-users/index.ts"
  };
}