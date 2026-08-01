const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, country_code = "91", resend = false, reqId } = await req.json();

    // For resend, reqId is required
    if (resend && !reqId) {
      return new Response(
        JSON.stringify({ error: "Missing request ID for resend" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For initial send, validate phone
    if (!resend) {
      if (!phone || !/^\d{10}$/.test(phone)) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number. Please provide a 10-digit number." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const authKey = Deno.env.get("MSG91_AUTH_KEY");
    const widgetId = Deno.env.get("MSG91_WIDGET_ID");
    const tokenAuth = Deno.env.get("MSG91_TOKEN_AUTH");

    // Diagnostic logging (prefix + suffix only, no full values)
    const debugCred = (val: string | undefined, name: string) => {
      if (!val) return `${name}: NOT SET`;
      return `${name}: len=${val.length}, prefix=${val.substring(0, 6)}, suffix=${val.substring(val.length - 4)}`;
    };
    console.log("Credential diagnostics:", [
      debugCred(authKey, "AUTH_KEY"),
      debugCred(widgetId, "WIDGET_ID"),
      debugCred(tokenAuth, "TOKEN_AUTH"),
    ].join(" | "));

    if (!authKey || !widgetId || !tokenAuth) {
      console.error("MSG91 Widget credentials not configured");
      return new Response(
        JSON.stringify({ error: "OTP service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: any;

    if (resend) {
      // ─── Retry OTP via Widget API ───
      const retryRes = await fetch("https://api.msg91.com/api/v5/widget/retryOtp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reqId,
          retryChannel: 11,
          authkey: authKey,
          widgetId,
          tokenAuth,
        }),
      });
      data = await retryRes.json();
      console.log("MSG91 Widget retry response:", JSON.stringify(data));
    } else {
      // ─── Send OTP via Widget API ───
      const identifier = `${country_code}${phone}`;
      const requestBody = {
        identifier,
        widgetId,
        tokenAuth,
        authkey: authKey,
      };
      console.log("MSG91 Widget sendOtp request body (no secrets):", {
        identifier,
        widgetIdPrefix: widgetId.substring(0, 6) + "...",
        tokenAuthPrefix: tokenAuth.substring(0, 6) + "...",
      });

      const sendRes = await fetch("https://api.msg91.com/api/v5/widget/sendOtp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      data = await sendRes.json();
      console.log("MSG91 Widget send response:", JSON.stringify(data));
    }

    // Strictly check for success — do NOT use response.ok as fallback
    if (data.type === "success") {
      return new Response(
        JSON.stringify({
          success: true,
          message: resend ? "OTP resent" : "OTP sent",
          reqId: data.reqId || data.message || reqId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Error from MSG91
    console.error("MSG91 Widget OTP failed:", JSON.stringify(data));
    return new Response(
      JSON.stringify({ error: data.message || "Failed to send OTP. Please try again." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send OTP error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
