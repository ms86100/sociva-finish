/** Platform checkout payment mode: one online rail at a time, or off (COD-only). */

export type PaymentGatewayMode = "off" | "upi_deep_link" | "razorpay";

export async function getPaymentGatewayMode(
  supabase: { rpc: (fn: string) => Promise<{ data: unknown; error: unknown }> },
): Promise<PaymentGatewayMode> {
  const { data, error } = await supabase.rpc("get_public_payment_mode");
  if (error) {
    console.error("[payment-gateway-mode] failed to load mode:", error);
    return "upi_deep_link";
  }
  if (data === "off" || data === "razorpay" || data === "upi_deep_link") {
    return data;
  }
  return "upi_deep_link";
}

export function paymentModeBlockedResponse(
  mode: PaymentGatewayMode,
  required: PaymentGatewayMode,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: `Online checkout requires payment mode "${required}" (current: "${mode}")`,
      payment_gateway_mode: mode,
    }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
