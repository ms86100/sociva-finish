// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Bell, MessageCircle, Tag, Volume2, Loader2, AlertTriangle, ExternalLink, Moon } from 'lucide-react';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { usePushNotifications } from '@/contexts/PushNotificationContext';
import { WhatsAppUpdatesCta } from '@/components/notifications/WhatsAppUpdatesCta';
import { openNotificationChannelSettings, ORDERS_INCOMING_CHANNEL_ID } from '@/lib/notification-channel-settings';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  fetchNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/notification-preferences';

export default function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { requestFullPermission } = usePushNotifications();
  const [osPermission, setOsPermission] = useState<'granted' | 'denied' | 'prompt' | 'loading'>('loading');
  const { showFeedback } = useFeedbackPopup();

  // Check OS-level notification permission on mount and on resume
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setOsPermission('granted'); // Web — no OS banner needed
      return;
    }

    const checkPermission = async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const result = await PushNotifications.checkPermissions();
        setOsPermission(result.receive as 'granted' | 'denied' | 'prompt');
      } catch {
        setOsPermission('granted');
      }
    };

    checkPermission();

    // Re-check when user returns from Settings
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) checkPermission();
        });
        cleanup = () => listener.remove();
      } catch {
        // Resume listener is optional outside the native runtime.
      }
    })();

    return () => cleanup?.();
  }, []);

  const openAppSettings = async () => {
    const result = await openNotificationChannelSettings(ORDERS_INCOMING_CHANNEL_ID);
    if (!result.opened) {
      toast.error('Could not open settings. Please go to Settings → Sociva → Notifications manually.');
    }
  };

  // placeholderData keeps isLoading false so a hung/slow prefs fetch never blanks the screen
  const {
    data: preferences = DEFAULT_NOTIFICATION_PREFERENCES,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
      return fetchNotificationPreferences(supabase as any, user.id);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_NOTIFICATION_PREFERENCES,
    // Prefer a single timed attempt over multi-retry spinner lag on mobile.
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: async (newPrefs: NotificationPreferences) => {
      if (!user?.id) return;
      const { error } = await (supabase.from('notification_preferences') as any)
        .upsert({
          user_id: user.id,
          ...newPrefs,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', user?.id] });
    },
    onError: (error: any) => {
      toast.error('Failed to save preference. Please try again.');
      console.error('[Notifications] Save error:', error);
    },
  });

  const updatePreference = (key: keyof NotificationPreferences, value: boolean | number) => {
    const newPrefs = { ...preferences, [key]: value };
    mutation.mutate(newPrefs);
  };

  const notificationItems = [
    {
      key: 'orders' as const,
      icon: Bell,
      title: 'Order Updates',
      description: 'Get notified about order status changes',
    },
    {
      key: 'chat' as const,
      icon: MessageCircle,
      title: 'Chat Messages',
      description: 'Receive notifications for new messages',
    },
    {
      key: 'promotions' as const,
      icon: Tag,
      title: 'Promotions',
      description: 'Special offers and featured sellers. WhatsApp marketing is sent only when this and WhatsApp updates are both on.',
    },
    {
      key: 'sounds' as const,
      icon: Volume2,
      title: 'Notification Sounds',
      description: 'Play sounds for notifications',
    },
  ];

  return (
    <AppLayout showHeader={false} showNav={true} safeTop={false}>
      <div>
        <SafeHeader>
          <div className="px-4 pb-3.5 flex items-center gap-3">
          <Link to="/profile" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 active:scale-95 transition-transform">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Notification Settings</h1>
            <p className="text-xs text-muted-foreground">Choose what notifications you want to receive</p>
          </div>
          {isFetching && (
            <Loader2 className="animate-spin text-muted-foreground shrink-0" size={16} aria-label="Refreshing preferences" />
          )}
          </div>
        </SafeHeader>

        <div className="p-4">

        {/* OS-level permission banner */}
        {osPermission === 'denied' && (
          <button
            onClick={openAppSettings}
            className="w-full mb-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-foreground">Notifications are disabled</p>
              <p className="text-xs text-muted-foreground">Tap to open Settings and enable notifications for Sociva</p>
            </div>
            <ExternalLink size={16} className="text-muted-foreground shrink-0" />
          </button>
        )}

        {osPermission === 'prompt' && Capacitor.isNativePlatform() && (
          <button
            onClick={async () => {
              try {
                // Direct call in tap handler — preserves iOS user-gesture context
                const permResult = await PushNotifications.requestPermissions();

                if (permResult.receive !== 'granted') {
                  setOsPermission(permResult.receive as 'granted' | 'denied' | 'prompt');
                  return;
                }

                // Let requestFullPermission handle register() with listener gate
                requestFullPermission().catch(e => console.warn('[Push] Background reconciliation:', e));

                setOsPermission('granted');
                showFeedback({
                  title: 'Notifications enabled!',
                  variant: 'success'
                });
              } catch {
                // ignore errors
              }
            }}
            className="w-full mb-4 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Bell size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-foreground">Enable push notifications</p>
              <p className="text-xs text-muted-foreground">Tap to allow Sociva to send you notifications</p>
            </div>
          </button>
        )}

        {isError && (
          <button
            type="button"
            onClick={() => void refetch()}
            className="w-full mb-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-left active:scale-[0.98] transition-transform"
          >
            <AlertTriangle size={18} className="text-destructive shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Couldn’t load saved preferences</p>
              <p className="text-xs text-muted-foreground">Showing defaults — tap to retry</p>
            </div>
          </button>
        )}

        <div className="space-y-3">
          {notificationItems.map(({ key, icon: Icon, title, description }) => (
            <Card key={key}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Icon size={20} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <Label htmlFor={key} className="font-medium cursor-pointer">
                    {title}
                  </Label>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  id={key}
                  checked={preferences[key]}
                  onCheckedChange={(checked) => updatePreference(key, checked)}
                  disabled={mutation.isPending}
                />
              </CardContent>
            </Card>
          ))}

          <WhatsAppUpdatesCta variant="settings" audience="generic" />

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Moon size={20} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <Label htmlFor="quiet_hours_enabled" className="font-medium cursor-pointer">
                  Quiet hours
                </Label>
                <p className="text-xs text-muted-foreground">
                  Mute non-urgent push from {preferences.quiet_hours_start}:00–{preferences.quiet_hours_end}:00 (order alerts still ring)
                </p>
              </div>
              <Switch
                id="quiet_hours_enabled"
                checked={preferences.quiet_hours_enabled}
                onCheckedChange={(checked) => updatePreference('quiet_hours_enabled', checked)}
                disabled={mutation.isPending}
              />
            </CardContent>
          </Card>

          {Capacitor.getPlatform() === 'android' && (
            <button
              type="button"
              onClick={() => void openAppSettings()}
              className="w-full flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Bell size={20} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Incoming order sound channel</p>
                <p className="text-xs text-muted-foreground">Open Android settings for “Incoming Orders” (orders_incoming_v1)</p>
              </div>
              <ExternalLink size={16} className="text-muted-foreground shrink-0" />
            </button>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Your preferences are synced across all your devices.
        </p>
        </div>
      </div>
    </AppLayout>
  );
}
