import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/credentials.ts";
import {
  logWhatsAppMessage,
  normalizeWhatsAppPhone,
  sendBookingCancelled,
  sendBookingConfirmation,
  sendBookingReminder,
  sendOTP,
  sendWhatsAppText,
} from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Body = {
  phoneNumber?: string;
  message?: string;
  /** Optional named template helpers */
  template?: "otp" | "booking_confirmation" | "booking_cancelled" | "booking_reminder" | "raw";
  data?: Record<string, string>;
};

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createAdminClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userData.user.id });
  if (!isAdmin) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Admin only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return { userId: userData.user.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  try {
    const body = (await req.json()) as Body;
    const phoneNumber = body.phoneNumber || "";
    const phone = normalizeWhatsAppPhone(phoneNumber);
    if (!phone) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "invalid_phone",
          error: "Invalid phone. Use country code + number digits only, e.g. 9198XXXXXXXX",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const template = body.template || "raw";
    let result;
    let messageText = body.message || "";

    if (template === "otp") {
      const otp = body.data?.otp || body.message || "";
      if (!otp) {
        return new Response(JSON.stringify({ success: false, code: "meta_error", error: "otp required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      messageText = `Your Sociva verification code is ${otp}. Do not share this code.`;
      result = await sendOTP(phone, otp);
    } else if (template === "booking_confirmation") {
      result = await sendBookingConfirmation({
        phoneNumber: phone,
        customerName: body.data?.customerName || "there",
        bookingId: body.data?.bookingId || "—",
        providerName: body.data?.providerName || "your provider",
        serviceDate: body.data?.serviceDate || "",
        serviceTime: body.data?.serviceTime || "",
      });
      messageText = body.message || "booking_confirmation";
    } else if (template === "booking_cancelled") {
      result = await sendBookingCancelled({
        phoneNumber: phone,
        customerName: body.data?.customerName || "there",
        bookingId: body.data?.bookingId || "—",
        providerName: body.data?.providerName || "your provider",
        reason: body.data?.reason,
      });
      messageText = body.message || "booking_cancelled";
    } else if (template === "booking_reminder") {
      result = await sendBookingReminder({
        phoneNumber: phone,
        customerName: body.data?.customerName || "there",
        bookingId: body.data?.bookingId || "—",
        providerName: body.data?.providerName || "your provider",
        serviceDate: body.data?.serviceDate || "",
        serviceTime: body.data?.serviceTime || "",
      });
      messageText = body.message || "booking_reminder";
    } else {
      if (!messageText.trim()) {
        return new Response(
          JSON.stringify({ success: false, code: "meta_error", error: "message is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      result = await sendWhatsAppText({ phoneNumber: phone, message: messageText });
    }

    await logWhatsAppMessage({
      direction: "outbound",
      phone,
      message: messageText,
      meta_message_id: result.metaMessageId || null,
      status: result.success ? "sent" : "failed",
      error_code: result.success ? null : result.code,
      error_message: result.error || null,
      template_name: template === "raw" ? null : template,
      meta_payload: result.meta ?? null,
      created_by: userId,
    });

    const status = result.success ? 200 : result.code === "unauthorized" || result.code === "token_expired" ? 401 : result.code === "rate_limited" ? 429 : result.code === "invalid_phone" ? 400 : 502;

    return new Response(
      JSON.stringify({
        success: result.success,
        code: result.code,
        error: result.error,
        meta: result.meta,
        metaMessageId: result.metaMessageId,
        elapsedMs: result.elapsedMs,
        httpStatus: result.httpStatus,
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[send-whatsapp]", e);
    return new Response(
      JSON.stringify({ success: false, code: "unexpected", error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
