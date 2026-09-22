// @ts-nocheck
import { useState } from 'react';
import { Bell, MapPin, X, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { usePermissionLifecycle } from '@/hooks/usePermissionLifecycle';
import { openAppNotificationSettings } from '@/lib/notification-channel-settings';
import { openLocationSettings } from '@/lib/location-settings';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

type Variant = 'card' | 'banner' | 'sheet';

type Props = {
  variant?: Variant;
  /** When true, only render if something needs attention (and not on cooldown for banner). */
  attentionOnly?: boolean;
  className?: string;
  onDismissed?: () => void;
};

function statusLabel(state: string): string {
  if (state === 'enabled') return 'On';
  if (state === 'denied' || state === 'restricted') return 'Off';
  if (state === 'not_requested') return 'Not set';
  return 'Unknown';
}

/**
 * Single Permission Center — Get the most from Sociva.
 * All surfaces (Profile / Home / post-login) share this component + usePermissionLifecycle.
 */
export function PermissionCenter({
  variant = 'card',
  attentionOnly = false,
  className,
  onDismissed,
}: Props) {
  const {
    notificationPermission,
    locationPermission,
    showLocSoftPrompt,
    notifNeedsAttention,
    locNeedsAttention,
    dismissNotifPrompt,
    dismissLocPrompt,
    dismissAll,
    enableNotifications,
    enableLocation,
  } = usePermissionLifecycle();

  const [busyNotif, setBusyNotif] = useState(false);
  const [busyLoc, setBusyLoc] = useState(false);

  if (!Capacitor.isNativePlatform()) return null;

  if (attentionOnly) {
    if (variant === 'banner') {
      // Home strip is location-only — notification prompts belong in Profile / post-login.
      if (!showLocSoftPrompt) return null;
    } else if (!notifNeedsAttention && !locNeedsAttention) {
      return null;
    }
  }

  const handleEnableNotif = async () => {
    setBusyNotif(true);
    try {
      const result = await Promise.race([
        enableNotifications(),
        new Promise<'denied'>((resolve) => setTimeout(() => resolve('denied'), 15000)),
      ]);
      if (result === 'settings') {
        const opened = await openAppNotificationSettings();
        if (!opened) {
          notify.block('Open Settings → Sociva → Notifications to enable alerts.');
        }
      } else if (result === 'granted') {
        notify.success('Notifications enabled');
      } else {
        notify.block('Notifications were not enabled. Try again from Profile.');
      }
    } finally {
      setBusyNotif(false);
    }
  };

  const handleEnableLoc = async () => {
    setBusyLoc(true);
    try {
      const result = await Promise.race([
        enableLocation(),
        new Promise<'denied'>((resolve) => setTimeout(() => resolve('denied'), 15000)),
      ]);
      if (result === 'settings') {
        const opened = await openLocationSettings();
        if (!opened.opened) {
          notify.block('Open Settings → Sociva → Location to enable nearby discovery.');
        }
      } else if (result === 'granted') {
        notify.success('Location enabled');
      } else {
        notify.block('Could not get your location yet. You can pick a place manually.');
      }
    } finally {
      setBusyLoc(false);
    }
  };

  const handleMaybeLater = async () => {
    await dismissAll();
    onDismissed?.();
  };

  const notifDenied = notificationPermission === 'denied';
  const locDenied =
    locationPermission === 'denied' || locationPermission === 'restricted';

  if (variant === 'banner') {
    // Compact home strip — location soft prompt only (no notification Enable spinner here).
    if (!showLocSoftPrompt) return null;

    return (
      <div
        className={cn(
          'mx-4 mt-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm relative',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => {
            dismissLocPrompt();
            onDismissed?.();
          }}
          className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="rounded-full bg-primary/10 p-2 shrink-0">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold text-foreground">Discover more around you</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Turn on location to see Sociva sellers, products and services near you.
            </p>
            <Button
              size="sm"
              className="h-8"
              disabled={busyLoc}
              onClick={() => void handleEnableLoc()}
            >
              {busyLoc ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : locDenied ? (
                <>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Open Settings
                </>
              ) : (
                'Enable Location'
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // card + sheet share the same body
  const body = (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-foreground">Get the most from Sociva</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Stay updated and discover what&apos;s available around you.
          </p>
        </div>
        {variant === 'sheet' && (
          <button
            type="button"
            onClick={() => void handleMaybeLater()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border/60 divide-y divide-border/60 overflow-hidden">
        <div className="p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold">Notifications</span>
            </div>
            <span
              className={cn(
                'text-[11px] font-bold uppercase tracking-wide',
                notificationPermission === 'enabled' ? 'text-emerald-600' : 'text-muted-foreground',
              )}
            >
              {statusLabel(notificationPermission)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Stay updated on orders, offers and what&apos;s happening in your community.
          </p>
          {notificationPermission !== 'enabled' && (
            <Button
              size="sm"
              className="w-full h-9"
              disabled={busyNotif}
              onClick={() => void handleEnableNotif()}
            >
              {busyNotif ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : notifDenied ? (
                <>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open Settings
                </>
              ) : (
                'Enable'
              )}
            </Button>
          )}
        </div>

        <div className="p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold">Location</span>
            </div>
            <span
              className={cn(
                'text-[11px] font-bold uppercase tracking-wide',
                locationPermission === 'enabled' ? 'text-emerald-600' : 'text-muted-foreground',
              )}
            >
              {statusLabel(locationPermission)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Discover sellers and services available around you. You can always pick a place manually.
          </p>
          {locationPermission !== 'enabled' && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-9"
              disabled={busyLoc}
              onClick={() => void handleEnableLoc()}
            >
              {busyLoc ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : locDenied ? (
                <>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open Settings
                </>
              ) : (
                'Enable'
              )}
            </Button>
          )}
        </div>
      </div>

      {(notificationPermission !== 'enabled' || locationPermission !== 'enabled') && (
        <button
          type="button"
          onClick={() => void handleMaybeLater()}
          className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground py-1"
        >
          Maybe later
        </button>
      )}
    </div>
  );

  if (variant === 'sheet') {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[60] p-4 pb-[max(env(safe-area-inset-bottom),16px)] pointer-events-none">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-background p-4 shadow-2xl pointer-events-auto">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card p-4 shadow-sm', className)}>
      {body}
    </div>
  );
}
