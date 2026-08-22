import { getOrderNotifTitle } from '@/lib/order-notification-titles';
import { pickNotificationData } from '@/lib/notification-fields';

type NotifLike = {
  title?: string | null;
  body?: string | null;
  type?: string | null;
  data?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
};

/** Client-side fallback when queue/trigger wrote empty title or body. */
export function resolveNotificationDisplay(notification: NotifLike): { title: string; body: string } {
  const data = pickNotificationData(notification);
  const status = String(data.status || data.new_status || '').toLowerCase();
  const role: 'buyer' | 'seller' = data.target_role === 'seller' ? 'seller' : 'buyer';
  const sellerName = String(data.sellerName || data.providerName || data.seller_business_name || 'the seller');
  const buyerName = String(data.buyer_name || 'Customer');
  const itemSummary = String(data.item_summary || '').trim();

  let title = String(notification.title || '').trim();
  let body = String(notification.body || '').trim();

  if (!title) {
    title =
      getOrderNotifTitle(status, role) ||
      (notification.type === 'order' && role === 'seller' ? 'New Order Received' : null) ||
      (notification.type === 'order' ? 'Order Update' : 'Notification');
  }

  if (!body) {
    if (status === 'accepted' || status === 'auto_accepted') {
      body = `${sellerName} has accepted your order.`;
    } else if (status === 'preparing') {
      body = `${sellerName} is preparing your order.`;
    } else if (status === 'ready') {
      body = `Your order from ${sellerName} is ready.`;
    } else if (status === 'on_the_way') {
      body = `${sellerName} is on the way with your order.`;
    } else if (status === 'delivered' || status === 'completed') {
      body = `Your order from ${sellerName} has been delivered.`;
    } else if (status === 'cancelled') {
      body = `Your order was cancelled.`;
    } else if (status === 'placed' && role === 'seller') {
      body = `${buyerName} placed a new order${itemSummary ? `: ${itemSummary}` : ''}. Tap to review and accept.`;
    } else if (itemSummary) {
      body = itemSummary;
    } else if (status) {
      body = `Your order is now ${status.replace(/_/g, ' ')}.`;
    } else {
      body = 'Tap to view details.';
    }
  }

  return { title, body };
}
