import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Creates dedicated integration-test users with known credentials.
 * Uses service_role to auto-confirm and create profiles.
 * Idempotent — skips if users already exist.
 */
const TEST_USERS = [
  {
    email: "integration-admin@test.sociva.com",
    password: "TestAdmin2026!",
    name: "Integration Admin",
    flat_number: "ADMIN-01",
    block: "Admin Block",
    role: "admin",
    phone: "9876543201",
  },
  {
    email: "integration-seller@test.sociva.com",
    password: "TestSeller2026!",
    name: "Integration Seller",
    flat_number: "S-101",
    block: "Tower A",
    role: "seller",
    phone: "9876543202",
  },
  {
    email: "integration-buyer@test.sociva.com",
    password: "TestBuyer2026!",
    name: "Integration Buyer",
    flat_number: "B-204",
    block: "Tower C",
    role: "buyer",
    phone: "9876543203",
  },
  {
    email: "integration-guard@test.sociva.com",
    password: "TestGuard2026!",
    name: "Integration Guard",
    flat_number: "G-001",
    block: "Gate Block",
    role: "guard",
    phone: "9876543204",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // C4: Block in production unless explicitly allowed
  if (!Deno.env.get("ALLOW_TEST_FUNCTIONS")) {
    return new Response(
      JSON.stringify({ error: "Test functions are disabled in this environment" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get or create the test societies.
    // Look up by SLUG (the unique key) — looking up by name would miss a
    // renamed row and then fail the insert on societies_slug_key.
    const ensureSociety = async (society: Record<string, unknown>): Promise<string> => {
      const { data: existing } = await supabase
        .from("societies")
        .select("id")
        .eq("slug", society.slug as string)
        .maybeSingle();

      if (existing) return existing.id as string;

      const { data: created, error } = await supabase
        .from("societies")
        .upsert(society, { onConflict: "slug" })
        .select("id")
        .single();

      if (error) throw error;
      return created!.id as string;
    };

    const societyId = await ensureSociety({
      name: "Integration Test Society",
      slug: "integration-test-society",
      address: "123 Test Lane, Bangalore",
      latitude: 13.035,
      longitude: 77.65,
      is_active: true,
      security_mode: "basic",
    });

    // Second society for cross-society tests
    const society2Id = await ensureSociety({
      name: "Integration Test Society 2",
      slug: "integration-test-society-2",
      address: "456 Test Ave, Bangalore",
      latitude: 13.037,
      longitude: 77.652,
      is_active: true,
      security_mode: "basic",
    });


    const results: Record<string, { id: string; email: string; society_id: string; created: boolean }> = {};

    // Fetch all existing users once (avoid repeated calls)
    const { data: existingUsers } = await supabase.auth.admin.listUsers();

    for (const user of TEST_USERS) {
      const existing = existingUsers?.users?.find((u: any) => u.email === user.email);
      const userSociety = user.role === "buyer" ? society2Id : societyId;
      let userId: string;

      if (existing) {
        userId = existing.id;
      } else {
        // Create user with auto-confirm
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
        });
        if (authErr) throw authErr;
        userId = authData.user!.id;
      }

      // Upsert profile (ensures profile exists even for pre-existing users)
      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: userId,
        name: user.name,
        email: user.email,
        flat_number: user.flat_number,
        block: user.block,
        society_id: userSociety,
        verification_status: "approved",
        phone: user.phone,
      }, { onConflict: "id" });

      if (profileErr) {
        console.error(`Profile upsert error for ${user.email}:`, profileErr);
      }

      // Grant admin role if needed (upsert to avoid duplicates)
      if (user.role === "admin") {
        await supabase.from("user_roles").upsert(
          { user_id: userId, role: "admin" },
          { onConflict: "user_id,role" }
        );
      }

      // Make guard a security officer (upsert)
      if (user.role === "guard") {
        const { data: existingStaff } = await supabase
          .from("security_staff")
          .select("id")
          .eq("user_id", userId)
          .eq("society_id", societyId)
          .maybeSingle();

        if (!existingStaff) {
          await supabase.from("security_staff").insert({
            user_id: userId,
            society_id: societyId,
            is_active: true,
          });
        }
      }

      results[user.role] = { id: userId, email: user.email, society_id: userSociety, created: !existing };
    }

    return new Response(
      JSON.stringify({
        success: true,
        society_id: societyId,
        society_2_id: society2Id,
        users: results,
        credentials: TEST_USERS.map((u) => ({ email: u.email, password: u.password, role: u.role })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
