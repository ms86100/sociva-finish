// @ts-nocheck
import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { pickNotificationRoute } from '@/lib/notification-routes';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, Inbox, RefreshCw, Package, Users, Truck, MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, cleanupStaleDeliveryNotifications, type UserNotification } from '@/hooks/queries/useNotifications';
import { RichNotificationCard } from '@/components/notifications/RichNotificationCard';

export default function NotificationInboxPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data,
    isLoading,
    isSuccess,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNotifications(user?.id);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flat();
  }, [data]);

  // Bug 1 fix: one-time stale cleanup on first successful fetch
  const cleanupRanRef = useRef(false);
  useEffect(() => {
    if (isSuccess && notifications.length > 0 && !cleanupRanRef.current && user?.id) {
      cleanupRanRef.current = true;
      cleanupStaleDeliveryNotifications(notifications).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
        queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
        queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
      }).catch(() => {});
    }
  }, [isSuccess, notifications, user?.id, queryClient]);

  const handleTap = useCallback((n: UserNotification) => {
    if (!n.is_read) markRead.mutate(n.id);
    const path = pickNotificationRoute(n as any);
    if (path && path.startsWith('/')) {
      navigate(path);
    }
  }, [markRead, navigate]);

  // Bug 2 fix: provide onDismiss for actionable cards in inbox
  const handleRichDismiss = useCallback((n: UserNotification) => {
    if (!n.is_read) markRead.mutate(n.id);
  }, [markRead]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <AppLayout headerTitle="Notifications" showLocation={false}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Button variant="ghost" size="sm" className="text-sm gap-1" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-sm gap-1" onClick={() => user && markAllRead.mutate(user.id)}>
              <CheckCheck size={14} /> Mark all read
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="mx-auto mb-3" size={40} />
            <p className="font-medium">No notifications yet</p>
            <p className="text-sm mt-1">You'll see updates from your society here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(n => {
              const hasAction = n.payload?.action && !n.is_read;

              if (hasAction) {
                return (
                  <RichNotificationCard key={n.id} notification={n} onDismiss={() => handleRichDismiss(n)} />
                );
              }

              return (
                <button
                  key={n.id}
                  onClick={() => handleTap(n)}
                  className={`w-full text-left rounded-xl p-3 transition-colors border min-h-[44px] ${
                    n.is_read
                      ? 'bg-card border-border'
                      : 'bg-primary/5 border-primary/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      n.is_read ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                    }`}>
                      {(() => {
                        const t = n.type || '';
                        if (t.includes('order') || t.includes('payment')) return <Package size={14} />;
                        if (t.includes('delivery') || t.includes('rider')) return <Truck size={14} />;
                        if (t.includes('community') || t.includes('bulletin')) return <Users size={14} />;
                        if (t.includes('chat') || t.includes('message')) return <MessageCircle size={14} />;
                        return <Bell size={14} />;
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-tight ${!n.is_read ? 'font-semibold' : 'font-medium'}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              );
            })}

            {hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-sm gap-1 mt-2"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 size={14} className="animate-spin" /> : null}
                {isFetchingNextPage ? 'Loading...' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
