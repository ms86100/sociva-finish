// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';
import { OrderItemStatusBadge, ItemStatus } from './OrderItemStatusBadge';
import { ChevronRight, Clock, CreditCard, Package, MessageSquare, User, Truck, ShoppingBag, CalendarDays, AlertTriangle, Zap } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface OrderItemWithStatus {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  status?: string;
}

interface SellerOrderCardOrder {
  id: string;
  created_at: string;
  total_amount: number;
  status: string;
  payment_status?: string | null;
  payment_type?: string | null;
  fulfillment_type?: string | null;
  order_type?: string | null;
  scheduled_date?: string | null;
  scheduled_time_start?: string | null;
  auto_cancel_at?: string | null;
  auto_accepted?: boolean;
  buyer?: { name: string; block: string; flat_number: string; phone?: string };
  items?: OrderItemWithStatus[];
}

interface SellerOrderCardProps {
  order: SellerOrderCardOrder;
}

export function SellerOrderCard({ order }: SellerOrderCardProps) {
  const { getFlowLabel } = useFlowStepLabels();
  const { formatPrice } = useCurrency();
  const buyer = order.buyer;
  const items = order.items || [];
  const statusInfo = getFlowLabel(order.status);

  // Calculate item-level stats
  const itemStatuses = items.map(item => item.status || 'pending');
  const pendingItems = itemStatuses.filter(s => s === 'pending').length;
  const preparingItems = itemStatuses.filter(s => s === 'preparing').length;
  const readyItems = itemStatuses.filter(s => s === 'ready').length;
  const deliveredItems = itemStatuses.filter(s => s === 'delivered').length;

  const getPaymentBadge = () => {
    if (order.payment_status === 'paid') {
      return <Badge variant="outline" className="text-success border-success text-[10px]">Paid</Badge>;
    }
    if (order.payment_type === 'cod') {
      return <Badge variant="outline" className="text-warning border-warning text-[10px]">COD</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground text-[10px]">Pending</Badge>;
  };

  // SLA countdown for pending orders
  const autoCancelAt = order.auto_cancel_at;
  const isPending = order.status === 'placed' || order.status === 'pending';
  const [slaSeconds, setSlaSeconds] = useState(() => {
    if (!autoCancelAt || !isPending) return -1;
    return Math.max(0, Math.floor((new Date(autoCancelAt).getTime() - Date.now()) / 1000));
  });
  const slaExpiredRef = useRef(false);

  useEffect(() => {
    if (!autoCancelAt || !isPending) return;
    slaExpiredRef.current = false;
    const calc = () => Math.max(0, Math.floor((new Date(autoCancelAt).getTime() - Date.now()) / 1000));
    setSlaSeconds(calc());
    const t = setInterval(() => {
      const v = calc();
      setSlaSeconds(v);
      if (v <= 0) slaExpiredRef.current = true;
    }, 1000);
    return () => clearInterval(t);
  }, [autoCancelAt, isPending]);

  const slaIsLow = slaSeconds >= 0 && slaSeconds <= 60;
  const slaIsActive = autoCancelAt && isPending && slaSeconds > 0;

  return (
    <Link to={`/orders/${order.id}`}>
      <Card className={cn(
        "hover:shadow-md transition-shadow",
        slaIsLow && slaIsActive && "border-destructive/60 animate-pulse"
      )}>
        <CardContent className="p-4">
          {/* Header: Customer & Order Status */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User size={14} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{buyer?.name || 'Customer'}</p>
                {['delivery', 'seller_delivery'].includes(order.fulfillment_type || '') && buyer?.block && (
                  <p className="text-[10px] text-muted-foreground">
                    {buyer.block}-{buyer.flat_number}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
              {order.auto_accepted && (
                <Badge variant="outline" className="text-[10px] border-success/40 text-success gap-0.5">
                  <Zap size={10} /> Auto
                </Badge>
              )}
              <div className="flex items-center gap-1">
                {['delivery', 'seller_delivery'].includes(order.fulfillment_type || '') ? (
                  <Badge variant="outline" className="text-[10px] border-primary/40 text-primary gap-0.5">
                    <Truck size={10} /> Delivery
                  </Badge>
                ) : order.order_type === 'booking' ? (
                  <Badge variant="outline" className="text-[10px] border-info/40 text-info gap-0.5">
                    <CalendarDays size={10} /> Service
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground gap-0.5">
                    <ShoppingBag size={10} /> Pickup
                  </Badge>
                )}
                {getPaymentBadge()}
              </div>
            </div>
          </div>

          {/* Scheduled Pre-order Indicator */}
          {order.scheduled_date && (
            <div className="flex items-center gap-1.5 mb-2 bg-accent/10 border border-accent/20 rounded-lg px-2.5 py-1.5 text-xs">
              <CalendarDays size={12} className="text-accent shrink-0" />
              <span className="text-accent font-medium">
                📅 Scheduled: {format(new Date(order.scheduled_date), 'MMM d')}
                {order.scheduled_time_start && ` at ${order.scheduled_time_start.slice(0, 5)}`}
              </span>
            </div>
          )}

          {/* SLA Countdown for pending orders */}
          {slaIsActive && (
            <div className={cn(
              "flex items-center gap-1.5 mb-3 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              slaIsLow ? "bg-destructive/10 border border-destructive/20 text-destructive" : "bg-warning/10 border border-warning/20 text-warning"
            )}>
              <AlertTriangle size={12} className="shrink-0" />
              <span>Respond in {Math.floor(slaSeconds / 60)}:{(slaSeconds % 60).toString().padStart(2, '0')} or auto-cancelled</span>
            </div>
          )}

          {/* Order Details Grid */}
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock size={12} />
              <span>{format(new Date(order.created_at), 'MMM d, h:mm a')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground justify-end">
              <CreditCard size={12} />
              <span className="font-medium text-foreground tabular-nums">{formatPrice(order.total_amount)}</span>
            </div>
          </div>

          {/* Items Summary */}
          <div className="bg-muted/50 rounded-lg p-2.5 mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">{items.length} Items</span>
            </div>
            
            {/* Show first 3 items with their individual status */}
            <div className="space-y-1.5">
              {items.slice(0, 3).map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground line-clamp-1 max-w-[65%]">
                    {item.quantity}x {item.product_name}
                  </span>
                  <OrderItemStatusBadge status={(item.status || 'pending') as ItemStatus} />
                </div>
              ))}
              {items.length > 3 && (
                <p className="text-[10px] text-muted-foreground">
                  +{items.length - 3} more items
                </p>
              )}
            </div>
          </div>

          {/* Item Status Summary Bar */}
          {items.length > 1 && (
            <div className="flex items-center gap-2 text-[10px] mb-2">
              {pendingItems > 0 && (
                <span className="text-muted-foreground">{pendingItems} pending</span>
              )}
              {preparingItems > 0 && (
                <span className="text-warning">{preparingItems} preparing</span>
              )}
              {readyItems > 0 && (
                <span className="text-info">{readyItems} ready</span>
              )}
              {deliveredItems > 0 && (
                <span className="text-success">{deliveredItems} delivered</span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare size={10} />
              <span>View details & chat</span>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
