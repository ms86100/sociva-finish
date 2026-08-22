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
    else if (status === "placed" && role === "seller") title = "New Order Received";
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
    else if (status === "placed" && role === "seller") {
      body = `${buyerName} placed a new order${itemSummary ? `: ${itemSummary}` : ""}. Tap to review and accept.`;
    } else if (itemSummary) body = itemSummary;
    else if (status) body = `Your order is now ${status.replace(/_/g, " ")}.`;
    else body = "Tap to view details.";
  }

  return { title, body };
}
