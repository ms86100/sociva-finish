// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check, X, CreditCard, MessageSquare, Bell, MapPin, KeyRound, MessageCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { adminNotify } from '@/lib/admin-notify';

interface CredentialConfig {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  multiline?: boolean;
}

interface CredentialSetting {
  id: string;
  key: string;
  value: string | null;
  is_active: boolean;
  description: string | null;
}

const CREDENTIAL_TABS = [
  {
    id: 'payment',
    label: 'Payment',
    icon: CreditCard,
    credentials: [
      { key: 'payment_gateway_mode', label: 'Payment Mode', description: 'Choose Off (COD-only), UPI Deep Link (direct to seller), or Razorpay gateway. Only one online rail can be active at a time.', placeholder: 'upi_deep_link', isToggle: true },
      { key: 'razorpay_key_id', label: 'Razorpay Key ID', description: 'Public key for UPI/card payments via Razorpay', placeholder: 'rzp_live_...' },
      { key: 'razorpay_key_secret', label: 'Razorpay Key Secret', description: 'Secret key for payment verification (keep private)', placeholder: 'Your secret key' },
      { key: 'razorpay_webhook_secret', label: 'Razorpay Webhook Secret', description: 'HMAC secret from Razorpay Dashboard → Webhooks (not the API key secret)', placeholder: 'whsec_...' },
      { key: 'razorpay_route_enabled', label: 'Razorpay Route Payouts', description: 'Enable only after seller linked accounts exist. When false, settlements stay Eligible (owed) — never auto-marked paid out.', placeholder: 'false', isToggle: true },
    ] as (CredentialConfig & { isToggle?: boolean })[],
  },
  {
    id: 'sms',
    label: 'SMS / OTP',
    icon: MessageSquare,
    credentials: [
      { key: 'msg91_auth_key', label: 'MSG91 Auth Key', description: 'Authentication key for MSG91 OTP service', placeholder: 'Your MSG91 auth key' },
      { key: 'msg91_widget_id', label: 'MSG91 Widget ID', description: 'Widget ID for OTP widget integration', placeholder: 'Widget ID' },
      { key: 'msg91_token_auth', label: 'MSG91 Token Auth', description: 'Token for widget authentication', placeholder: 'Token auth value' },
      { key: 'msg91_otp_template_id', label: 'MSG91 OTP Template ID', description: 'Template ID for OTP messages', placeholder: 'Template ID' },
    ] as CredentialConfig[],
  },
  {
    id: 'push',
    label: 'Push',
    icon: Bell,
    credentials: [
      { key: 'firebase_service_account', label: 'Firebase Service Account JSON', description: 'Full service account JSON for FCM push notifications', placeholder: '{"type":"service_account",...}', multiline: true },
      { key: 'apns_key_p8', label: 'APNs Key (.p8)', description: 'Apple Push Notification Service private key content', placeholder: '-----BEGIN PRIVATE KEY-----...', multiline: true },
      { key: 'apns_key_id', label: 'APNs Key ID', description: '10-character key identifier from Apple Developer portal', placeholder: 'ABC123DEF4' },
      { key: 'apns_team_id', label: 'APNs Team ID', description: 'Apple Developer Team ID', placeholder: 'TEAM123456' },
      { key: 'apns_bundle_id', label: 'APNs Bundle ID', description: 'iOS app bundle identifier', placeholder: 'com.yourapp.bundle' },
    ] as CredentialConfig[],
  },
  {
    id: 'maps',
    label: 'Maps',
    icon: MapPin,
    credentials: [
      { key: 'google_maps_api_key', label: 'Google Maps API Key', description: 'Required for location features and address autocomplete', placeholder: 'AIza...' },
    ] as CredentialConfig[],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    credentials: [
      { key: 'whatsapp_access_token', label: 'Access Token', description: 'Meta WhatsApp Cloud API permanent token (or set WHATSAPP_ACCESS_TOKEN secret)', placeholder: 'EAAG...' },
      { key: 'whatsapp_phone_number_id', label: 'Phone Number ID', description: 'WhatsApp Phone Number ID from Meta Developer Console', placeholder: '1234567890' },
      { key: 'whatsapp_verify_token', label: 'Webhook Verify Token', description: 'Custom string Meta will echo on webhook GET verification', placeholder: 'sociva-wa-verify-...' },
      { key: 'whatsapp_business_account_id', label: 'Business Account ID', description: 'Optional WABA ID for template management', placeholder: '1234567890' },
    ] as CredentialConfig[],
  },
];

const ALL_KEYS = CREDENTIAL_TABS.flatMap(t => t.credentials.map(c => c.key));
const TOGGLE_KEYS = new Set(
  CREDENTIAL_TABS.flatMap(t => t.credentials.filter((c: any) => c.isToggle).map(c => c.key))
);

export function CredentialsManager() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<CredentialSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      let rows: CredentialSetting[] = [];
      const configured: Record<string, boolean> = {};

      const { data, error } = await supabase.rpc('get_admin_credential_meta', {
        p_keys: ALL_KEYS,
      });

      if (!error && data) {
        rows = (data || []).map((s: any) => {
          configured[s.key] = !!s.is_configured;
          return {
            id: s.id,
            key: s.key,
            value: s.public_value || null,
            is_active: s.is_active,
            description: s.description,
          };
        });
      } else {
        // P0: never SELECT raw admin_settings.value — meta RPC is required
        console.error('get_admin_credential_meta failed', error);
        adminNotify.error('Credential settings could not be loaded safely. Secrets were not exposed.', { id: 'credential-meta-unavailable' });
        rows = [];
      }

      setSettings(rows);
      setConfiguredKeys(configured);
      const values: Record<string, string> = {};
      rows.forEach((s) => {
        values[s.key] = TOGGLE_KEYS.has(s.key) ? (s.value || '') : '';
      });
      setEditValues(values);
    } catch (error) {
      console.error('Error fetching credentials:', error);
      adminNotify.error(error, { id: 'credentials-load-error', title: 'Could not load credentials' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (key: string) => {
    setIsSaving(key);
    try {
      const existingSetting = settings.find(s => s.key === key);
      const value = (editValues[key] || '').trim();
      if (!value) {
        adminNotify.warning('Enter a new value before saving this credential.', { id: `credential-empty:${key}` });
        return;
      }
      if (value.includes('•')) {
        adminNotify.warning('Enter a new secret value rather than the masked placeholder.', { id: `credential-masked:${key}` });
        return;
      }
      const config = CREDENTIAL_TABS.flatMap(t => t.credentials).find(c => c.key === key);

      if (existingSetting) {
        const { error } = await supabase.rpc('upsert_admin_credential', {
          p_key: key,
          p_value: value,
          p_description: config?.description || null,
          p_is_active: true,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('upsert_admin_credential', {
          p_key: key,
          p_value: value,
          p_description: config?.description || null,
          p_is_active: true,
        });
        if (error) throw error;
      }
      adminNotify.success('Credential saved and activated.', { id: `credential-saved:${key}` });
      setEditValues({ ...editValues, [key]: '' });
      await fetchSettings();
    } catch (error) {
      console.error('Error saving credential:', error);
      adminNotify.error(error, { id: `credential-save-error:${key}`, title: 'Could not save credential' });
    } finally {
      setIsSaving(null);
    }
  };

  const toggleActive = async (key: string, isActive: boolean) => {
    try {
      const { error } = await supabase.rpc('set_admin_credential_active', {
        p_key: key,
        p_is_active: isActive,
      } as any);
      if (error) throw error;
      await fetchSettings();
      adminNotify.success(isActive ? 'Credential enabled.' : 'Credential disabled.', { id: `credential-active:${key}` });
    } catch (error) {
      adminNotify.error(error, { id: `credential-active-error:${key}`, title: 'Could not update credential' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  const renderCredentialField = (config: CredentialConfig & { isToggle?: boolean }) => {
    const setting = settings.find(s => s.key === config.key);
    const hasValue = !!configuredKeys[config.key] || !!(setting?.value && setting.value !== '••••••••');
    const isActive = setting?.is_active ?? false;
    const isSecret = !config.isToggle;

    // Special payment mode: Off | UPI Direct | Razorpay (one rail at a time)
    if (config.isToggle && config.key === 'payment_gateway_mode') {
      const currentMode = setting?.value || 'upi_deep_link';
      const isRazorpay = currentMode === 'razorpay';
      const isOff = currentMode === 'off';
      const isUpi = currentMode === 'upi_deep_link';
      const razorpayKeySet = !!configuredKeys['razorpay_key_id'];
      const webhookSecretSet = !!configuredKeys['razorpay_webhook_secret'] && !!settings.find(s => s.key === 'razorpay_webhook_secret')?.is_active;

      const applyMode = async (newMode: 'off' | 'upi_deep_link' | 'razorpay') => {
        if (newMode === currentMode) return;
        if (newMode === 'razorpay' && !razorpayKeySet) {
          adminNotify.warning('Configure the Razorpay Key ID and Key Secret before enabling gateway mode.', { id: 'razorpay-keys-required', title: 'Razorpay setup incomplete' });
          return;
        }
        if (newMode === 'razorpay' && !webhookSecretSet) {
          adminNotify.warning('Add and activate the Razorpay webhook secret before enabling gateway mode.', { id: 'razorpay-webhook-required', title: 'Webhook secret required' });
          return;
        }
        const previousSettings = settings;
        setEditValues(values => ({ ...values, [config.key]: newMode }));
        setSettings(current => setting
          ? current.map(row => row.key === config.key
              ? { ...row, value: newMode, is_active: true }
              : row)
          : [...current, {
              id: `optimistic:${config.key}`,
              key: config.key,
              value: newMode,
              is_active: true,
              description: config.description,
            }]);
        try {
          const { error } = await supabase.rpc('set_payment_gateway_mode' as any, {
            p_mode: newMode,
          });
          if (error) throw error;
          await queryClient.invalidateQueries({ queryKey: ['payment-gateway-mode'] });
          await fetchSettings();
          const labels = { off: 'Off (COD-only)', upi_deep_link: 'UPI Direct', razorpay: 'Razorpay Gateway' } as const;
          adminNotify.success(
            `Payment mode is now ${labels[newMode]}.`,
            { id: 'payment-mode-updated', title: 'Payment mode updated' },
          );
        } catch (err) {
          setSettings(previousSettings);
          setEditValues(values => ({ ...values, [config.key]: currentMode }));
          adminNotify.error(err, { id: 'payment-mode-update-error', title: 'Could not switch payment mode' });
        }
      };

      const modeBtn = (mode: 'off' | 'upi_deep_link' | 'razorpay', label: string, active: boolean) => (
        <button
          type="button"
          key={mode}
          onClick={() => applyMode(mode)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            active
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:border-primary/40'
          }`}
        >
          {label}
        </button>
      );

      return (
        <div key={config.key} className="space-y-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
          {!webhookSecretSet && (
            <div className="rounded-lg px-3 py-2 text-xs bg-amber-500/10 text-amber-800 border border-amber-500/30">
              Razorpay webhook secret is empty. Paste the signing secret from Razorpay Dashboard → Webhooks before enabling gateway mode. Do not reuse the API key secret.
            </div>
          )}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">{config.label}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {modeBtn('off', 'Off', isOff)}
              {modeBtn('upi_deep_link', 'UPI Direct', isUpi)}
              {modeBtn('razorpay', 'Razorpay', isRazorpay)}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{config.description}</p>
          <div className={`rounded-lg px-3 py-2 text-xs ${
            isOff
              ? 'bg-muted text-muted-foreground'
              : isRazorpay
                ? 'bg-accent/10 text-accent'
                : 'bg-primary/10 text-primary'
          }`}>
            {isOff
              ? '💵 Online payments off. Buyers pay cash at pickup or delivery (seller fulfillment unchanged).'
              : isRazorpay
                ? '🏦 Payments routed through Razorpay API. Automatic verification.'
                : '📱 Buyers pay directly to seller UPI ID. Manual verification via UTR + seller confirmation.'}
          </div>
          {!razorpayKeySet && (
            <p className="text-[10px] text-muted-foreground">⚠️ Razorpay keys not configured. Gateway mode requires valid API keys.</p>
          )}
        </div>
      );
    }

    // Razorpay Route payouts gate (default off — settled only after real transfer id)
    if (config.isToggle && config.key === 'razorpay_route_enabled') {
      const routeOn = setting?.is_active === true && String(setting?.value || '').toLowerCase() === 'true';
      return (
        <div key={config.key} className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border/40">
          <div className="flex items-center justify-between">
            <Label className="font-semibold text-sm">{config.label}</Label>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${!routeOn ? 'text-primary' : 'text-muted-foreground'}`}>Off</span>
              <Switch
                checked={routeOn}
                onCheckedChange={async (checked) => {
                  const newVal = checked ? 'true' : 'false';
                  setEditValues({ ...editValues, [config.key]: newVal });
                  try {
                    const { error } = await supabase.rpc('upsert_admin_credential', {
                      p_key: config.key,
                      p_value: newVal,
                      p_description: config.description || null,
                      p_is_active: checked,
                    });
                    if (error) throw error;
                    adminNotify.success(
                      checked
                        ? 'Route payouts ON — process-settlements will transfer only when sellers have razorpay_account_id'
                        : 'Razorpay Route payouts off — settlements stay Eligible (owed)',
                      { id: 'razorpay-route-updated', title: 'Route payout setting updated' },
                    );
                    await fetchSettings();
                  } catch (error) {
                    adminNotify.error(error, { id: 'razorpay-route-update-error', title: 'Could not update Route setting' });
                  }
                }}
              />
              <span className={`text-xs font-medium ${routeOn ? 'text-primary' : 'text-muted-foreground'}`}>On</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{config.description}</p>
          <div className="rounded-lg px-3 py-2 text-xs bg-warning/10 text-foreground border border-warning/30">
            Settled requires a real razorpay_transfer_id. Sellers without linked accounts stay Eligible.
          </div>
        </div>
      );
    }

    return (
      <div key={config.key} className="space-y-2.5 p-3.5 rounded-xl bg-muted/30 border border-border/40">
        <div className="flex items-center justify-between">
          <Label htmlFor={config.key} className="font-semibold text-sm">{config.label}</Label>
          {hasValue && (
            <div className="flex items-center gap-2">
              {isActive ? (
                <Badge variant="secondary" className="text-[10px] bg-accent/20 text-accent gap-0.5">
                  <Check size={10} /> Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] gap-0.5"><X size={10} /> Inactive</Badge>
              )}
              <Switch checked={isActive} onCheckedChange={checked => toggleActive(config.key, checked)} />
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{config.description}</p>
        {config.key === 'razorpay_webhook_secret' && !configuredKeys[config.key] && (
          <div className="rounded-lg px-3 py-2 text-xs bg-amber-500/10 text-amber-800 border border-amber-500/30">
            Required for Razorpay mode. Copy the Webhook Secret from Razorpay Dashboard → Settings → Webhooks. Never paste the API key secret here.
          </div>
        )}
        {isSecret && configuredKeys[config.key] && (
          <p className="text-[11px] text-muted-foreground">Configured — enter a new value to rotate. Raw secrets are never shown.</p>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            {config.multiline ? (
              <Textarea
                id={config.key}
                placeholder={configuredKeys[config.key] ? 'Enter new value to rotate…' : config.placeholder}
                value={editValues[config.key] || ''}
                onChange={e => setEditValues({ ...editValues, [config.key]: e.target.value })}
                className="rounded-lg text-xs font-mono min-h-[80px]"
                autoComplete="off"
              />
            ) : (
              <Input
                id={config.key}
                type="password"
                placeholder={configuredKeys[config.key] ? 'Enter new value to rotate…' : config.placeholder}
                value={editValues[config.key] || ''}
                onChange={e => setEditValues({ ...editValues, [config.key]: e.target.value })}
                className="rounded-lg"
                autoComplete="new-password"
              />
            )}
          </div>
          <Button onClick={() => handleSave(config.key)} disabled={isSaving === config.key} size="sm" className="rounded-lg shrink-0">
            {isSaving === config.key ? <Loader2 className="animate-spin" size={14} /> : 'Save'}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <KeyRound size={16} className="text-amber-600" />
            </div>
            Credentials Manager
          </CardTitle>
          <CardDescription className="text-xs">
            Manage API keys and secrets for all third-party integrations. Secrets are write-only in this UI — edge functions still resolve raw values from the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="payment" className="w-full">
            <TabsList className="w-full grid grid-cols-4 rounded-xl h-9 mb-4">
              {CREDENTIAL_TABS.map(tab => (
                <TabsTrigger key={tab.id} value={tab.id} className="text-[11px] rounded-lg font-semibold gap-1">
                  <tab.icon size={13} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {CREDENTIAL_TABS.map(tab => (
              <TabsContent key={tab.id} value={tab.id} className="space-y-4">
                {tab.credentials.map(renderCredentialField)}
              </TabsContent>
            ))}
          </Tabs>

          <div className="pt-4 mt-4 border-t border-border/40">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              🔒 Credentials are stored securely in the database. Edge functions read from here with environment secret fallback.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
