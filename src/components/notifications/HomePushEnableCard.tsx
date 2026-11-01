import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bell, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  consumePostLoginPermissionSheet,
  peekPostLoginPermissionSheet,
  reopenNotificationAsk,
  usePermissionLifecycle,
} from '@/hooks/usePermissionLifecycle';
import { hasSeenOnboarding } from '@/lib/onboarding-seen';
import {
  notificationAskCopy,
  shouldShowHomePushEnableCard,
  STAY_IN_THE_LOOP_COPY,
} from '@/lib/permission-prompt-rules';
import { peekPendingAuthAction } from '@/lib/pending-auth-action';
import { PermissionCenter } from '@/components/permissions/PermissionCenter';

/**
 * Stay in the Loop card on Home after login (any entry path).
 * Turn On: OS dialog if not denied; Settings if denied; explanatory sheet if deferred.
 * Not Now / close: dismiss card without requesting OS permission.
 */
export function HomePushEnableCard({ force = false }: { force?: boolean }) {
  const { user, isSeller, hasSellerProfile } = useAuth();
  const {
    notificationPermission,
    notifCooldown,
    enableNotifications,
    dismissNotifCard,
    openSettingsIfDenied,
    settingsRequired,
    isDeferred,
    cardDismissed,
    refreshFromOs,
  } = usePermissionLifecycle();
  const [busy, setBusy] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  const pending = peekPendingAuthAction();
  const checkoutInProgress =
    !force && (pending?.type === 'checkout' || pending?.type === 'add_to_cart');
  const postLoginAsk = force || peekPostLoginPermissionSheet();
  // force (Order Detail) bypasses onboarding gate; Home never uses force.
  const onboardingIncomplete = !force && !!user && !hasSeenOnboarding(user.id);

  const show = shouldShowHomePushEnableCard({
    hasUser: !!user,
    isNative: Capacitor.isNativePlatform(),
    notificationPermission,
    notifCooldown,
    checkoutInProgress,
    postLoginAsk,
    cardDismissed: force ? false : cardDismissed,
    onboardingIncomplete,
  });

  if (!show && !showSheet) return null;

  const seller = !!(isSeller || hasSellerProfile);
  const copy = seller ? notificationAskCopy(true) : {
    title: STAY_IN_THE_LOOP_COPY.title,
    body: STAY_IN_THE_LOOP_COPY.body,
  };
  const ctaLabel = settingsRequired
    ? 'Open Settings'
    : STAY_IN_THE_LOOP_COPY.cta;

  const handleCta = async () => {
    setBusy(true);
    try {
      if (settingsRequired) {
        const opened = await openSettingsIfDenied();
        if (!opened) {
          toast.error('Open Settings, then Sociva, then Notifications.');
        } else {
          void refreshFromOs();
        }
        return;
      }
      if (isDeferred || notificationPermission === 'not_requested') {
        // Deferred → reopen explanatory sheet; not_requested can go straight to Enable
        // from this card, but plan says deferred opens modal again.
        if (isDeferred) {
          reopenNotificationAsk();
          setShowSheet(true);
          return;
        }
      }
      const result = await Promise.race([
        enableNotifications(),
        new Promise<'settings'>((resolve) => setTimeout(() => resolve('settings'), 15000)),
      ]);
      if (result === 'granted') {
        consumePostLoginPermissionSheet();
        toast.success('Notifications are on');
        return;
      }
      // Declined OS dialog - keep the card so Open Settings is available.
      // Do not write card_dismissed (that is only for Not Now / close).
      consumePostLoginPermissionSheet();
      void refreshFromOs();
    } finally {
      setBusy(false);
    }
  };

  const handleNotNow = () => {
    consumePostLoginPermissionSheet();
    dismissNotifCard();
  };

  return (
    <>
      {show && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3.5 shadow-sm relative">
          <button
            type="button"
            onClick={handleNotNow}
            className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="rounded-full bg-primary/15 p-2 shrink-0">
              <Bell className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm font-semibold text-foreground">{copy.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {settingsRequired
                  ? 'Notifications are off. Allow them so you do not miss an order update.'
                  : copy.body}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleCta()}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ctaLabel}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={busy}
                  onClick={handleNotNow}
                >
                  {STAY_IN_THE_LOOP_COPY.secondary}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSheet && (
        <PermissionCenter
          variant="sheet"
          attentionOnly
          onDismissed={() => setShowSheet(false)}
        />
      )}
    </>
  );
}
