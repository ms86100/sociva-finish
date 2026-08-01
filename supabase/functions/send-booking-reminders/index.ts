import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReminderWindow {
  label: string;
  fromMin: number;
  toMin: number;
  titleEmoji: string;
  urgency: string;
}

const REMINDER_WINDOWS: ReminderWindow[] = [
  { label: '1_hour', fromMin: 55, toMin: 65, titleEmoji: '⏰', urgency: 'standard' },
  { label: '30_min', fromMin: 25, toMin: 35, titleEmoji: '⏱️', urgency: 'soon' },
  { label: '10_min', fromMin: 7, toMin: 13, titleEmoji: '🔔', urgency: 'imminent' },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    // Bug #17 fix: Bookings store local times (IST = UTC+5:30).
    // Offset the current UTC time to IST for comparison.
    const IST_OFFSET_MS = 5.5 * 60 * 60_000;
    const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
    const todayStr = nowIST.toISOString().split("T")[0];
    let totalReminded = 0;

    for (const window of REMINDER_WINDOWS) {
      const fromTime = new Date(nowIST.getTime() + window.fromMin * 60_000);
      const toTime = new Date(nowIST.getTime() + window.toMin * 60_000);
      // Extract HH:MM:SS in IST-adjusted time
      const fromTimeStr = fromTime.toISOString().slice(11, 19);
      const toTimeStr = toTime.toISOString().slice(11, 19);

      const { data: bookings, error } = await supabase
        .from("service_bookings")
        .select("id, order_id, buyer_id, seller_id, product_id, booking_date, start_time, end_time")
        .eq("booking_date", todayStr)
        .in("status", ["confirmed", "scheduled", "rescheduled", "requested"])
        .gte("start_time", fromTimeStr)
        .lte("start_time", toTimeStr);

      if (error) {
        console.error(`Error fetching bookings for ${window.label}:`, error);
        continue;
      }

      if (!bookings || bookings.length === 0) continue;

      for (const booking of bookings) {
        const timeStr = booking.start_time?.slice(0, 5) || "soon";
        const reminderType = `booking_reminder_${window.label}`;

        // Dedup: check if this exact reminder already sent for this booking
        const { count: existingCount } = await supabase
          .from("notification_queue")
          .select("id", { count: "exact", head: true })
          .eq("user_id", booking.buyer_id)
          .eq("type", reminderType)
          .contains("payload", { bookingId: booking.id });

        if (existingCount && existingCount > 0) continue;

        // Get product name
        const { data: product } = await supabase
          .from("products")
          .select("name")
          .eq("id", booking.product_id)
          .single();

        const productName = product?.name || "your appointment";

        // Get seller info
        const { data: seller } = await supabase
          .from("seller_profiles")
          .select("user_id, business_name")
          .eq("id", booking.seller_id)
          .single();

        const timeLabel = window.label === '1_hour' ? '1 hour' :
                          window.label === '30_min' ? '30 minutes' : '10 minutes';

        // Determine action based on urgency
        const action = window.urgency === 'imminent' ? 'Open Now' :
                       window.urgency === 'soon' ? 'Get Ready' : 'View Details';

        // Notify buyer — deep link to specific order when available, fallback to orders list with booking context
        const buyerPath = booking.order_id ? `/orders/${booking.order_id}` : `/orders?bookingId=${booking.id}`;
        await supabase.from("notification_queue").insert({
          user_id: booking.buyer_id,
          title: `${window.titleEmoji} Appointment in ${timeLabel}`,
          body: `Your appointment for ${productName} is at ${timeStr} today.`,
          type: reminderType,
          reference_path: buyerPath,
          payload: {
            type: reminderType,
            entity_type: 'booking',
            entity_id: booking.id,
            workflow_status: 'reminder',
            action,
            bookingId: booking.id,
            orderId: booking.order_id,
          },
        });

        // Notify seller
        if (seller?.user_id) {
          // Dedup for seller too
          const { count: sellerCount } = await supabase
            .from("notification_queue")
            .select("id", { count: "exact", head: true })
            .eq("user_id", seller.user_id)
            .eq("type", reminderType)
            .contains("payload", { bookingId: booking.id });

          if (!sellerCount || sellerCount === 0) {
            const { data: buyer } = await supabase
              .from("profiles")
              .select("name")
              .eq("id", booking.buyer_id)
              .single();

            await supabase.from("notification_queue").insert({
              user_id: seller.user_id,
              title: `${window.titleEmoji} Upcoming Appointment`,
              body: `${buyer?.name || "A customer"} has an appointment for ${productName} at ${timeStr}.`,
              type: reminderType,
              reference_path: `/seller/orders`,
              payload: {
                type: reminderType,
                entity_type: 'booking',
                entity_id: booking.id,
                workflow_status: 'reminder',
                action,
                bookingId: booking.id,
              },
            });
          }
        }

        totalReminded++;
      }
    }

    return new Response(JSON.stringify({ reminded: totalReminded }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in send-booking-reminders:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
