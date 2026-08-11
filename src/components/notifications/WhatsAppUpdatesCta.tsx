// @ts-nocheck
import { useEffect, useState } from 'react';
import { MessageCircle, X, ExternalLink } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import {
  WHATSAPP_OPTIN_DISMISS_KEY,
  openWhatsAppOptIn,
  SOCIVA_WHATSAPP_DIGITS,
} from '@/lib/whatsapp-optin';
import { cn } from '@/lib/utils';

type Variant = 'banner' | 'compact' | 'settings';

const WHATSAPP_PREF_DEFAULTS = { whatsapp: true, whatsapp_opted_in_at: null as string | null };

interface WhatsAppUpdatesCtaProps {
  variant?: Variant;
  /** When true, hide after user dismissed or already opted in via CTA. */
  dismissible?: boolean;
  className?: string;
  /** Buyer-facing copy vs seller. */
  audience?: 'buyer' | 'seller' | 'generic';
}

function audienceCopy(audience: WhatsAppUpdatesCtaProps['audience']) {
  if (audience === 'seller') {
    return {
      title: 'Get WhatsApp order alerts',
      description: 'Send Hi to Sociva so we can text you new orders and status updates on WhatsApp.',
      cta: 'Send Hi for WhatsApp alerts',
    };
  }
  if (audience === 'buyer') {
    return {
      title: 'Get WhatsApp delivery updates',
      description: 'Send Hi to Sociva so we can message you order and delivery status on WhatsApp.',
      cta: 'Send Hi for delivery updates',
    };
  }
  return {
    title: 'WhatsApp status updates',
    description: 'Send Hi to Sociva to register for order and delivery updates on WhatsApp.',
    cta: 'Send Hi to register',
  };
}

export function WhatsAppUpdatesCta({
  variant = 'banner',
  dismissible = true,
  className,
  audience = 'generic',
}: WhatsAppUpdatesCtaProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedbackPopup();
  const copy = audienceCopy(audience);
  const [dismissed, setDismissed] = useState(
    () => (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(WHATSAPP_OPTIN_DISMISS_KEY) === '1'),
  );
  const [opening, setOpening] = useState(false);

  const { data: prefs } = useQuery({
    queryKey: ['notification-preferences-whatsapp', user?.id],
    queryFn: async () => {
      if (!user?.id) return { ...WHATSAPP_PREF_DEFAULTS };
      try {
        const fetchPromise = (supabase.from('notification_preferences') as any)
          .select('whatsapp, whatsapp_opted_in_at')
          .eq('user_id', user.id)
          .maybeSingle();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('whatsapp prefs timed out')), 8000);
        });
        const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
        if (error) {
          console.warn('[WhatsApp CTA] prefs fetch failed:', error);
          return { ...WHATSAPP_PREF_DEFAULTS };
        }
        return {
          whatsapp: data?.whatsapp !== false,
          whatsapp_opted_in_at: data?.whatsapp_opted_in_at ?? null,
        };
      } catch (e) {
        console.warn('[WhatsApp CTA] prefs fetch failed/timed out:', e);
        return { ...WHATSAPP_PREF_DEFAULTS };
      }
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    placeholderData: WHATSAPP_PREF_DEFAULTS,
  });

  // Hide dismissible banners once user has already completed opt-in flow
  const alreadyOptedIn = !!prefs?.whatsapp_opted_in_at;

  useEffect(() => {
    if (alreadyOptedIn && dismissible && variant !== 'settings') {
      setDismissed(true);
    }
  }, [alreadyOptedIn, dismissible, variant]);

  const handleOpen = async () => {
    if (!user?.id) {
      toast.error('Please sign in to enable WhatsApp updates');
      return;
    }
    setOpening(true);
    try {
      await openWhatsAppOptIn(user.id);
      queryClient.invalidateQueries({ queryKey: ['notification-preferences-whatsapp', user.id] });
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', user.id] });
      showFeedback({
        title: 'WhatsApp opened — tap Send to register for updates',
        variant: 'success',
      });
      if (dismissible && variant !== 'settings') {
        sessionStorage.setItem(WHATSAPP_OPTIN_DISMISS_KEY, '1');
        setDismissed(true);
      }
    } catch (e) {
      console.warn('[WhatsApp CTA] open failed:', e);
      toast.error('Could not open WhatsApp. Message +91 99029 20804 manually.');
    } finally {
      setOpening(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    const { error } = await (supabase.from('notification_preferences') as any).upsert(
      {
        user_id: user.id,
        whatsapp: enabled,
        ...(enabled ? { whatsapp_opted_in_at: prefs?.whatsapp_opted_in_at || now } : {}),
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      toast.error('Failed to save WhatsApp preference');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['notification-preferences-whatsapp', user.id] });
    queryClient.invalidateQueries({ queryKey: ['notification-preferences', user.id] });
    if (enabled && !prefs?.whatsapp_opted_in_at) {
      // Encourage opening the 24h window when enabling without prior opt-in
      toast.message('WhatsApp enabled', {
        description: 'Send Hi so we can message you within Meta’s 24h window.',
        action: { label: 'Open WhatsApp', onClick: () => void handleOpen() },
      });
    }
  };

  if (!user) return null;

  if (variant === 'settings') {
    return (
      <Card className={cn(className)}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <MessageCircle size={20} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <Label htmlFor="whatsapp-pref" className="font-medium cursor-pointer">
                WhatsApp updates
              </Label>
              <p className="text-xs text-muted-foreground">
                Order, delivery, and booking alerts via WhatsApp (+91 99029 20804). Marketing offers need Promotions + this toggle.
              </p>
            </div>
            <Switch
              id="whatsapp-pref"
              checked={prefs?.whatsapp !== false}
              onCheckedChange={(checked) => void handleToggle(checked)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => void handleOpen()}
            disabled={opening}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {opening ? 'Opening…' : 'Send Hi to register for updates'}
          </Button>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Sending a message opens a 24-hour window so Sociva can text you status updates.
            Approved templates will work without a recent Hi later. Promotional WhatsApp is opt-in only
            (Promotions + WhatsApp both enabled) — we never send marketing without that consent.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (dismissible && (dismissed || alreadyOptedIn)) return null;

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={opening}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left active:scale-[0.98] transition-transform',
          className,
        )}
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <MessageCircle size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">{copy.title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{copy.cta}</p>
        </div>
        <ExternalLink size={14} className="text-muted-foreground shrink-0" />
      </button>
    );
  }

  // banner (default)
  return (
    <div className={cn('rounded-xl border bg-card p-3.5 shadow-sm relative', className)}>
      {dismissible && (
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(WHATSAPP_OPTIN_DISMISS_KEY, '1');
            setDismissed(true);
          }}
          className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3 pr-5">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <MessageCircle className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 space-y-0.5 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{copy.title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{copy.description}</p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="w-full mt-3 gap-2"
        onClick={() => void handleOpen()}
        disabled={opening}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {opening ? 'Opening…' : copy.cta}
      </Button>
      <p className="text-[10px] text-muted-foreground mt-2 text-center">
        Opens WhatsApp to +{SOCIVA_WHATSAPP_DIGITS}
      </p>
    </div>
  );
}
