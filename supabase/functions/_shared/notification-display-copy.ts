/**
 * Fallback copy for queue items with empty title/body (edge worker).
 */
export function resolveQueueDisplayCopy(item: {
  title?: string | null;
  body?: string | null;
  type?: string | null;
  payload?: Record<string, unknown> | null;
}): { title: string; body: string } {
  const payload = item.payload || {};
  const status = String(payload.status || payload.new_status || "").toLowerCase();
  const role = payload.target_role === "seller" ? "seller" : "buyer";
  const sellerName = String(payload.sellerName || payload.providerName || payload.seller_business_name || "the seller");
  const buyerName = String(payload.buyer_name || "Customer");
  const itemSummary = String(payload.item_summary || "").trim();

  let title = String(item.title || "").trim();
  let body = String(item.body || "").trim();

  if (!title) {
    if (status === "accepted" || status === "auto_accepted") title = "Order Accepted";
    else if (status === "preparing") title = "Order Being Prepared";
    else if (status === "ready") title = "Order Ready";
    else if (status === "on_the_way") title = "Order On The Way";
    else if (status === "delivered") title = "Order Delivered";
    else if (status === "refund_completed" && role === "buyer") title = "Sociva Balance added";
    else if (status === "refund_requested" && role === "seller") title = "Refund / dispute needs response";
    else if (status === "payment_verify_pending" && role === "seller") title = "Mark payment received";
    else if (status === "placed" && role === "seller") title = "New Order Received";
    else if (status === "refund_requested" || status === "refund_request") {
      title = role === "seller" ? "Refund request received" : "Refund request submitted";
    } else if (item.type === "refund_request") title = role === "seller" ? "Refund request received" : "Refund update";
    else if (item.type === "seller_store_submitted" || item.type === "seller_store_under_review") title = "Store under review";
    else if (item.type === "seller_approved") title = "Store approved";
    else if (item.type === "order") title = "New Order";
    else title = "Order Update";
  }

  if (!body) {
    if (status === "accepted" || status === "auto_accepted") body = `${sellerName} has accepted your order.`;
    else if (status === "preparing") body = `${sellerName} is preparing your order.`;
    else if (status === "ready") body = `Your order from ${sellerName} is ready.`;
    else if (status === "on_the_way") body = `${sellerName} is on the way with your order.`;
    else if (status === "delivered" || status === "completed") body = `Your order from ${sellerName} has been delivered.`;
    else if (status === "cancelled") body = "Your order was cancelled.";
    else if (status === "payment_verify_pending" && role === "seller") {
      body = `${buyerName} confirmed payment${itemSummary ? ` for ${itemSummary}` : ''}. Tap to verify and accept the order.`;
    } else if (status === "refund_completed" && role === "buyer") {
      const dest = String(payload.refund_destination || "").toLowerCase();
      const amt = payload.refund_amount || payload.approved_amount;
      if (dest === "wallet") {
        body = `Your refund${amt ? ` of ₹${amt}` : ""} has been added to your Sociva Balance for eligible online purchases on Sociva.`;
      } else {
        body = `Your refund${amt ? ` of ₹${amt}` : ""} has been completed.`;
      }
    } else if (status === "refund_requested" && role === "seller") {
      body = `${buyerName} opened a refund / dispute${itemSummary ? ` (${itemSummary})` : ''}. Review evidence and respond within 48 hours.`;
    } else if (status === "placed" && role === "seller") {
      body = `${buyerName} placed a new order${itemSummary ? `: ${itemSummary}` : ""}. Tap to review and accept.`;
    } else if (status === "refund_requested" || status === "refund_request" || item.type === "refund_request") {
      const amount = payload.refund_amount || payload.amount;
      const orderId = String(payload.orderId || payload.order_id || "").slice(0, 8).toUpperCase();
      if (role === "seller") {
        body = `${buyerName} requested a refund${orderId ? ` on order #${orderId}` : ""}${itemSummary ? ` (${itemSummary})` : ""}${amount ? ` — ${amount}` : ""}. Review it in Disputes & Refunds.`;
      } else {
        body = `We received your refund request${orderId ? ` for order #${orderId}` : ""}. We'll notify you when the seller or admin responds.`;
      }
    } else if (item.type === "seller_store_submitted" || item.type === "seller_store_under_review") {
      body = "Your store application is with our team. You'll get a notification when the review is complete.";
    } else if (item.type === "seller_approved") {
      body = "Your store passed review. Recharge Sociva Credits to go live for buyers nearby.";
    } else if (itemSummary) body = itemSummary;
    else if (status) body = `Your order is now ${status.replace(/_/g, " ")}.`;
    else body = "Tap to view details.";
  }

  return { title, body };
}
