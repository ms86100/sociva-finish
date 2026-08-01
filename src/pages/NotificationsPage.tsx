// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Bell, MessageCircle, Tag, Volume2, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { usePushNotifications } from '@/contexts/PushNotificationContext';

interface NotificationPreferences {
  orders: boolean;
  chat: boolean;
  promotions: boolean;
  sounds: boolean;
}

const defaultPreferences: NotificationPreferences = {
  orders: true,
  chat: true,
  promotions: true,
  sounds: true,
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { requestFullPermission } = usePushNotifications();
  const [osPermission, setOsPermission] = useState<'granted' | 'denied' | 'prompt' | 'loading'>('loading');

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
      } catch {}
    })();

    return () => cleanup?.();
  }, []);

  const openAppSettings = async () => {
    try {
      const { App } = await import('@capacitor/app');
      // On iOS this opens the app's settings page in Settings.app
      // On Android it opens the app info page
      if (Capacitor.getPlatform() === 'ios') {
        await (App as any).openUrl({ url: 'app-settings:' });
      } else {
        await (App as any).openUrl({ url: 'app-settings:' });
      }
    } catch (e) {
      toast.error('Could not open settings. Please go to Settings → Sociva → Notifications manually.');
    }
  };

  const { data: preferences = defaultPreferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return defaultPreferences;
      const { data, error } = await (supabase.from('notification_preferences') as any)
        .select('orders, chat, promotions, sounds')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('[Notifications] Failed to fetch preferences:', error);
        return defaultPreferences;
      }
      return data ? { orders: data.orders, chat: data.chat, promotions: data.promotions, sounds: data.sounds } : defaultPreferences;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
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

  const updatePreference = (key: keyof NotificationPreferences, value: boolean) => {
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
      description: 'Special offers and featured sellers',
    },
    {
      key: 'sounds' as const,
      icon: Volume2,
      title: 'Notification Sounds',
      description: 'Play sounds for notifications',
    },
  ];

  return (
    <AppLayout showHeader={false} showNav={true}>
      <div>
        <SafeHeader>
          <div className="px-4 pb-3.5 flex items-center gap-3">
          <Link to="/profile" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 active:scale-95 transition-transform">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Notification Settings</h1>
            <p className="text-xs text-muted-foreground">Choose what notifications you want to receive</p>
          </div>
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
                toast.success('Notifications enabled!');
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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : (
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
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          Your preferences are synced across all your devices.
        </p>
        </div>
      </div>
    </AppLayout>
  );
}
