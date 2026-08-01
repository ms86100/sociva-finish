import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { helpRequestId, societyId, authorId, title, tag } = await req.json();

    if (!helpRequestId || !societyId || !authorId || !title) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all users in the same society (except the author)
    const { data: societyMembers, error: membersError } = await supabase
      .from("profiles")
      .select("id")
      .eq("society_id", societyId)
      .neq("id", authorId)
      .eq("verification_status", "approved");

    if (membersError) {
      throw new Error(`Failed to fetch members: ${membersError.message}`);
    }

    if (!societyMembers || societyMembers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No society members to notify", sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get author name
    const { data: author } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", authorId)
      .single();

    const tagLabels: Record<string, string> = {
      borrow: "🤝 Borrow",
      emergency: "🚨 Emergency",
      question: "❓ Question",
      offer: "🎁 Offer",
    };

    const notifTitle = `${tagLabels[tag] || "Help"} Request`;
    const notifBody = `${author?.name || "A neighbor"}: ${title}`;

    // Send push notification to each member
    const sendUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
    const results = await Promise.allSettled(
      societyMembers.map(async (member) => {
        const response = await fetch(sendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            userId: member.id,
            title: notifTitle,
            body: notifBody,
            data: { type: "help_request", helpRequestId },
          }),
        });
        return response.json();
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    return new Response(
      JSON.stringify({ message: `Notified ${succeeded} members`, sent: succeeded }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Help request notification error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
