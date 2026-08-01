// @ts-nocheck
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Package, Star, Calendar, Bell, MapPin, AlertTriangle, Truck, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { UserNotification } from '@/hooks/queries/useNotifications';
import { useMarkNotificationRead } from '@/hooks/queries/useNotifications';
import { pickNotificationRoute } from '@/lib/notification-routes';

function getIcon(type: string) {
  switch (type) {
    case 'order':
    case 'order_status':
    case 'order_update':
      return <Package className="text-primary" size={28} />;
    case 'review':
      return <Star className="text-accent-foreground" size={28} />;
    case 'booking':
    case 'reminder':
    case 'booking_reminder_1_hour':
    case 'booking_reminder_30_min':
    case 'booking_reminder_10_min':
      return <Calendar className="text-primary" size={28} />;
    case 'chat':
    case 'message':
      return <MessageCircle className="text-primary" size={28} />;
    case 'delivery_en_route':
    case 'delivery_proximity':
      return <Truck className="text-primary" size={28} />;
    case 'delivery_proximity_imminent':
      return <MapPin className="text-destructive" size={28} />;
    case 'delivery_stalled':
    case 'delivery_delayed':
      return <AlertTriangle className="text-warning" size={28} />;
    default:
      return <Bell className="text-primary" size={28} />;
  }
}

function isUrgentType(type: string): boolean {
  return ['delivery_proximity_imminent', 'booking_reminder_10_min'].includes(type);
}

function formatActionLabel(action: string): string {
  const map: Record<string, string> = {
    view_order: 'View Order',
    view_orders: 'View Orders',
    view_booking: 'View Booking',
    view_delivery: 'View Delivery',
    track_order: 'Track Order',
    rate_order: 'Rate Order',
    accept_order: 'Accept Order',
    reply: 'Reply',
    view_message: 'View Message',
    view_chat: 'View Chat',
    view: 'View',
  };
  const key = action.toLowerCase().trim();
  if (map[key]) return map[key];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface Props {
  notification: UserNotification;
  onDismiss?: () => void;
}

export function RichNotificationCard({ notification, onDismiss }: Props) {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const action = notification.payload?.action;
  const urgent = isUrgentType(notification.type);

  const handleAction = () => {
    if (!notification.is_read) markRead.mutate(notification.id);
    const target = pickNotificationRoute(notification as any);
    if (target?.startsWith('/')) {
      navigate(target);
    }
    onDismiss?.();
  };

  const handleDismiss = () => {
    if (!notification.is_read) markRead.mutate(notification.id);
    onDismiss?.();
  };

  return (
    <Card className={cn(
      "overflow-hidden shadow-lg",
      urgent
        ? "border-destructive/30 bg-gradient-to-br from-destructive/10 to-background animate-pulse"
        : "border-primary/20 bg-gradient-to-br from-primary/5 to-background"
    )}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
            urgent ? "bg-destructive/10" : "bg-primary/10"
          )}>
            {getIcon(notification.type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className={cn("shrink-0", urgent ? "text-destructive" : "text-primary")} />
              <h3 className="font-bold text-base text-foreground leading-tight truncate">
                {notification.title}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{notification.body}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {action && (
            <Button size="sm" className={cn("flex-1", urgent && "bg-destructive hover:bg-destructive/90")} onClick={handleAction}>
              {formatActionLabel(String(action))}
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={handleDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
