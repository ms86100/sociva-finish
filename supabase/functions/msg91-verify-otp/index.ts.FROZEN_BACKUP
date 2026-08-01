import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Map MSG91 error codes to user-friendly messages
function getFriendlyError(code?: number, message?: string): string {
  if (code === 703 || message?.includes("already verif")) return "This OTP has already been used. Please request a new one.";
  if (code === 705 || message?.includes("invalid otp")) return "Incorrect OTP. Please check the code and try again.";
  if (code === 706 || message?.includes("expired")) return "OTP has expired. Please request a new one.";
  if (code === 707 || message?.includes("max attempt")) return "Too many attempts. Please request a new OTP.";
  if (message?.includes("mobile not found")) return "Phone number not found. Please go back and re-enter your number.";
  return "Verification failed. Please request a new OTP and try again.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reqId, otp, phone, country_code = "91" } = await req.json();

    if (!reqId) {
      return new Response(JSON.stringify({ error: "Please go back and re-enter your phone number." }), { status: 400, headers: jsonHeaders });
    }

    if (!otp || !/^\d{4,6}$/.test(otp)) {
      return new Response(JSON.stringify({ error: "Please enter a valid 4-digit OTP." }), { status: 400, headers: jsonHeaders });
    }

    if (!phone || !/^\d{10}$/.test(phone)) {
      return new Response(JSON.stringify({ error: "Invalid phone number." }), { status: 400, headers: jsonHeaders });
    }

    const authKey = Deno.env.get("MSG91_AUTH_KEY");
    const widgetId = Deno.env.get("MSG91_WIDGET_ID");
    const tokenAuth = Deno.env.get("MSG91_TOKEN_AUTH");
    if (!authKey || !widgetId || !tokenAuth) {
      return new Response(JSON.stringify({ error: "OTP service is temporarily unavailable. Please try again later." }), { status: 500, headers: jsonHeaders });
    }

    // ─── 1. Verify OTP via Widget API ───
    const verifyRes = await fetch("https://api.msg91.com/api/v5/widget/verifyOtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reqId, otp, widgetId, tokenAuth, authkey: authKey }),
    });
    const verifyData = await verifyRes.json();
    console.log("MSG91 verify response type:", verifyData.type, "code:", verifyData.code);

    if (verifyData.type !== "success") {
      return new Response(
        JSON.stringify({ error: getFriendlyError(verifyData.code, verifyData.message) }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // OTP verified successfully — use the phone number from the request
    // (MSG91 already validated it matches the reqId)
    const mobile = `${country_code}${phone}`;
    const fullPhone = `+${mobile}`;
    const syntheticEmail = `${mobile}@phone.sociva.app`;

    // ─── 2. Find or create Supabase user ───
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let isNewUser = false;
    let userEmail = syntheticEmail;

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, email")
      .eq("phone", fullPhone)
      .maybeSingle();

    if (existingProfile) {
      const { data: { user: authUser } } = await adminClient.auth.admin.getUserById(existingProfile.id);
      if (authUser?.email) userEmail = authUser.email;
      console.log("Found existing user:", existingProfile.id);
    } else {
      isNewUser = true;

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: syntheticEmail,
        phone: fullPhone,
        phone_confirm: true,
        email_confirm: true,
        user_metadata: { phone: fullPhone, name: "User" },
      });

      if (createError) {
        if (createError.message?.includes("already") || createError.message?.includes("duplicate")) {
          console.log("User exists with synthetic email, treating as existing");
          const { data: profileByEmail } = await adminClient
            .from("profiles").select("id").eq("email", syntheticEmail).maybeSingle();
          isNewUser = !profileByEmail;
        } else {
          console.error("Create user error:", createError);
          return new Response(
            JSON.stringify({ error: "Account setup failed. Please try again." }),
            { status: 500, headers: jsonHeaders }
          );
        }
      } else if (newUser?.user) {
        const userId = newUser.user.id;
        const { error: profileError } = await adminClient.from("profiles").upsert(
          { id: userId, email: syntheticEmail, phone: fullPhone, name: "User", flat_number: "", block: "" },
          { onConflict: "id" }
        );
        if (profileError) console.warn("Profile upsert warning:", profileError.message);

        const { error: roleError } = await adminClient.from("user_roles").insert({ user_id: userId, role: "buyer" });
        if (roleError && !roleError.message?.includes("duplicate")) console.warn("Role insert warning:", roleError.message);

        console.log("Created new user:", userId);
      }
    }

    // ─── 3. Generate magiclink session ───
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("Generate link error:", linkError);
      return new Response(
        JSON.stringify({ error: "Session creation failed. Please try again." }),
        { status: 500, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: true, token_hash: linkData.properties.hashed_token, is_new_user: isNewUser }),
      { headers: jsonHeaders }
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
