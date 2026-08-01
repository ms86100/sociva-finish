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

    const { data: societies } = await supabase
      .from("societies")
      .select("id, name, trust_score")
      .eq("is_active", true);

    if (!societies || societies.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active societies" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const reportMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
    // Actually use previous month for the report
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1).toISOString();
    const monthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();

    let reportsGenerated = 0;

    for (const society of societies) {
      // Check if report already exists
      const { data: existing } = await supabase
        .from("society_reports")
        .select("id")
        .eq("society_id", society.id)
        .eq("report_month", prevMonthStr);

      if (existing && existing.length > 0) continue;

      // Gather metrics
      const [
        expenses, income,
        disputesOpened, disputesResolved,
        snagsOpened, snagsFixed,
        milestones, docs,
        qTotal, qAnswered,
        mCollected, mPending,
        ackedItems,
        bulletinPosts,
      ] = await Promise.all([
        supabase.from("society_expenses").select("amount").eq("society_id", society.id).gte("expense_date", monthStart).lte("expense_date", monthEnd),
        supabase.from("society_income").select("amount").eq("society_id", society.id).gte("income_date", monthStart).lte("income_date", monthEnd),
        supabase.from("dispute_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("dispute_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["resolved", "closed"]).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("snag_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("snag_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["fixed", "verified", "closed"]).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("construction_milestones").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("project_documents").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("project_questions").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("project_questions").select("id", { count: "exact", head: true }).eq("society_id", society.id).eq("is_answered", true).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("maintenance_dues").select("id", { count: "exact", head: true }).eq("society_id", society.id).eq("status", "paid").like("month", `${prevMonthStr}%`),
        supabase.from("maintenance_dues").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["pending", "overdue"]).like("month", `${prevMonthStr}%`),
        supabase.from("dispute_tickets").select("created_at, acknowledged_at").eq("society_id", society.id).not("acknowledged_at", "is", null).gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("bulletin_posts").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", monthStart).lte("created_at", monthEnd),
      ]);

      const expTotal = (expenses.data || []).reduce((s: number, e: any) => s + Number(e.amount), 0);
      const incTotal = (income.data || []).reduce((s: number, e: any) => s + Number(e.amount), 0);

      let avgResponseHours: number | null = null;
      const acked = ackedItems.data || [];
      if (acked.length > 0) {
        const totalH = acked.reduce((sum: number, item: any) => {
          return sum + (new Date(item.acknowledged_at).getTime() - new Date(item.created_at).getTime()) / 3600000;
        }, 0);
        avgResponseHours = Math.round(totalH / acked.length);
      }

      const reportData = {
        financial: {
          expenses_total: expTotal,
          expenses_count: (expenses.data || []).length,
          income_total: incTotal,
          net_position: incTotal - expTotal,
        },
        governance: {
          disputes_opened: disputesOpened.count || 0,
          disputes_resolved: disputesResolved.count || 0,
          dispute_resolution_rate: (disputesOpened.count || 0) > 0
            ? Math.round(((disputesResolved.count || 0) / (disputesOpened.count || 0)) * 100)
            : null,
          snags_opened: snagsOpened.count || 0,
          snags_fixed: snagsFixed.count || 0,
          avg_response_hours: avgResponseHours,
        },
        transparency: {
          milestones: milestones.count || 0,
          documents_uploaded: docs.count || 0,
          qa_total: qTotal.count || 0,
          qa_answered: qAnswered.count || 0,
          qa_response_rate: (qTotal.count || 0) > 0
            ? Math.round(((qAnswered.count || 0) / (qTotal.count || 0)) * 100)
            : null,
        },
        community: {
          bulletin_posts: bulletinPosts.count || 0,
          maintenance_collected: mCollected.count || 0,
          maintenance_pending: mPending.count || 0,
        },
        trust_score: Number(society.trust_score || 0),
      };

      // Insert report
      await supabase.from("society_reports").insert({
        society_id: society.id,
        report_month: prevMonthStr,
        report_data: reportData,
        trust_score: reportData.trust_score,
      });

      // Notify all members
      const { data: members } = await supabase
        .from("profiles")
        .select("id")
        .eq("society_id", society.id)
        .eq("verification_status", "approved");

      if (members && members.length > 0) {
        const monthName = prevMonth.toLocaleString("en", { month: "long", year: "numeric" });
        const notifications = members.map((m) => ({
          user_id: m.id,
          title: `📊 Monthly Report Card — ${monthName}`,
          body: `Your society's monthly report is ready. Trust Score: ${reportData.trust_score.toFixed(1)}/10`,
          type: "monthly_report",
          reference_path: "/society/reports",
        }));

        for (let i = 0; i < notifications.length; i += 100) {
          await supabase.from("notification_queue").insert(notifications.slice(i, i + 100));
        }
      }

      reportsGenerated++;
    }

    return new Response(
      JSON.stringify({ message: `Generated ${reportsGenerated} reports`, generated: reportsGenerated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Report generation error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
