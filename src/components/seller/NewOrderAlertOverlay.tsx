// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, ShoppingBag, ArrowRight, Truck, Package, MapPin, Store } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { motion, AnimatePresence } from 'framer-motion';
import type { NewOrder } from '@/hooks/useNewOrderAlert';

const AUTO_DISMISS_SECONDS = 30;

interface NewOrderAlertOverlayProps {
  orders: NewOrder[];
  onDismiss: () => void;
  onDismissAll?: () => void;
  onSnooze?: (minutes?: number) => void;
  sellerProfiles?: { id: string; business_name: string }[];
}

const SNOOZE_PREF_KEY = 'seller_snooze_pref_minutes';
function readSnoozePref(): number | null {
  try {
    const raw = sessionStorage.getItem(SNOOZE_PREF_KEY);
    const v = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
function writeSnoozePref(minutes: number) {
  try { sessionStorage.setItem(SNOOZE_PREF_KEY, String(minutes)); } catch {}
}

function statusLabel(status: string): string {
  switch (status) {
    case 'enquired': return '📋 New Enquiry';
    case 'placed': return '🛒 New Order';
    case 'quoted': return '💬 Quote Request';
    case 'confirmed': return '📅 New Booking';
    case 'preparing': return '✅ Auto-Accepted';
    default: return '🔔 New Order';
  }
}

function fulfillmentLabel(order: NewOrder): { label: string; icon: React.ReactNode; className: string } {
  const ft = order.fulfillment_type || '';
  if (ft === 'seller_delivery' || (ft === 'delivery' && order.delivery_handled_by !== 'platform')) {
    return { label: 'Seller Delivery', icon: <Truck size={12} />, className: 'border-warning/40 text-warning' };
  }
  if (ft === 'delivery') {
    return { label: 'Delivery Partner', icon: <Truck size={12} />, className: 'border-primary/40 text-primary' };
  }
  if (ft === 'pickup' || ft === 'self_pickup') {
    return { label: 'Self Pickup', icon: <Package size={12} />, className: 'border-muted-foreground/40 text-muted-foreground' };
  }
  if (ft === 'at_seller' || ft === 'at_buyer') {
    return { label: ft === 'at_seller' ? 'At Your Location' : 'At Buyer Location', icon: <MapPin size={12} />, className: 'border-info/40 text-info' };
  }
  return { label: 'Pickup', icon: <Package size={12} />, className: 'border-muted-foreground/40 text-muted-foreground' };
}

export function NewOrderAlertOverlay({ orders, onDismiss, onDismissAll, onSnooze, sellerProfiles = [] }: NewOrderAlertOverlayProps) {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const [showSnoozePicker, setShowSnoozePicker] = useState(false);

  const order = orders.length > 0 ? orders[0] : null;
  const queueCount = orders.length;

  // Resolve store name for the current order
  const storeName = order?.seller_id
    ? sellerProfiles.find(s => s.id === order.seller_id)?.business_name
    : null;

  const handleBackgroundDismiss = useCallback(() => {
    if (onSnooze) onSnooze();
    else onDismiss();
  }, [onSnooze, onDismiss]);

  // Android back button handler
  useEffect(() => {
    if (!order) return;
    const onPopState = () => handleBackgroundDismiss();
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [order?.id, handleBackgroundDismiss]);

  // Auto-dismiss countdown
  useEffect(() => {
    if (!order) {
      setCountdown(AUTO_DISMISS_SECONDS);
      return;
    }
    setCountdown(AUTO_DISMISS_SECONDS);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (onSnooze) onSnooze();
          else onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [order?.id, onDismiss, onSnooze]);

  const handleView = () => {
    const orderId = order?.id;
    if (!orderId) {
      onDismiss();
      return;
    }
    try {
      navigate(`/orders/${orderId}`);
    } catch (e) {
      console.error('[OrderAlert] Navigation failed, falling back:', e);
      navigate('/orders');
    }
    if (onDismissAll) {
      onDismissAll();
    } else {
      onDismiss();
    }
  };

  const handleSnoozeRequest = () => {
    const pref = readSnoozePref();
    if (pref) {
      if (onSnooze) onSnooze(pref);
      else onDismiss();
      return;
    }
    setShowSnoozePicker(true);
  };

  const handlePickSnooze = (minutes: number) => {
    writeSnoozePref(minutes);
    setShowSnoozePicker(false);
    if (onSnooze) onSnooze(minutes);
    else onDismiss();
  };

  return (
    <AnimatePresence mode="wait">
      {order && (
        <motion.div
          key={`new-order-alert-${order.id}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6"
          onClick={handleBackgroundDismiss}
        >
          <motion.div
            initial={{ scale: 0.8, y: 40 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, y: 40 }}
            transition={{ type: 'spring', damping: 20 }}
            className="bg-background rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Store name badge */}
            {storeName && (
              <div className="flex justify-center">
                <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs font-semibold">
                  <Store size={12} />
                  {storeName}
                </Badge>
              </div>
            )}

            {/* Pulsing bell icon + queue badge */}
            <div className="flex justify-center relative">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
                className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center"
              >
                <Bell size={32} className="text-accent" />
              </motion.div>
              {queueCount > 1 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                  {queueCount}
                </span>
              )}
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-foreground">{statusLabel(order.status)}</h2>
              {order.total_amount > 0 && (
                <p className="text-2xl font-bold text-accent tabular-nums">{formatPrice(order.total_amount)}</p>
              )}
              {(() => {
                const ff = fulfillmentLabel(order);
                return (
                  <Badge variant="outline" className={`text-xs gap-1 ${ff.className}`}>
                    {ff.icon} {ff.label}
                  </Badge>
                );
              })()}
              <p className="text-sm text-muted-foreground">
                {order.status === 'preparing'
                  ? 'This order was auto-accepted. Start preparing!'
                  : queueCount > 1
                    ? `${queueCount} orders waiting — tap to view this one`
                    : 'Tap below to view and respond'}
              </p>
            </div>

            <Button
              className="w-full h-12 text-base bg-accent hover:bg-accent/90 text-accent-foreground gap-2"
              onClick={handleView}
            >
              <ShoppingBag size={18} />
              View Order
              <ArrowRight size={16} />
            </Button>

            {showSnoozePicker ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-foreground text-center">Remind me in…</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => handlePickSnooze(5)}>5 min</Button>
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => handlePickSnooze(10)}>10 min</Button>
                  <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={onDismiss}>Dismiss</Button>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">We'll remember your choice for this session.</p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={handleSnoozeRequest}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Remind me later
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Auto-dismiss in {countdown}s
                </span>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
