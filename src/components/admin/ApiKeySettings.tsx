// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff, Key, Check, X } from 'lucide-react';

interface ApiKeySetting {
  id: string;
  key: string;
  value: string | null;
  is_active: boolean;
  description: string | null;
}

const API_KEY_CONFIGS = [
  {
    key: 'razorpay_key_id',
    label: 'Razorpay Key ID',
    description: 'Public key for UPI/card payments via Razorpay',
    placeholder: 'rzp_live_...',
  },
  {
    key: 'razorpay_key_secret',
    label: 'Razorpay Key Secret',
    description: 'Secret key for payment verification (keep private)',
    placeholder: 'Your secret key',
  },
  {
    key: 'google_maps_api_key',
    label: 'Google Maps API Key',
    description: 'Required for location features and address autocomplete',
    placeholder: 'AIza...',
  },
  {
    key: 'twilio_account_sid',
    label: 'Twilio Account SID',
    description: 'For SMS OTP verification',
    placeholder: 'AC...',
  },
  {
    key: 'twilio_auth_token',
    label: 'Twilio Auth Token',
    description: 'For SMS OTP verification',
    placeholder: 'Your auth token',
  },
  {
    key: 'twilio_phone_number',
    label: 'Twilio Phone Number',
    description: 'The phone number to send SMS from',
    placeholder: '+1234567890',
  },
];

export function ApiKeySettings() {
  const [settings, setSettings] = useState<ApiKeySetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .in('key', API_KEY_CONFIGS.map((c) => c.key));

      if (error) throw error;
      setSettings(data || []);

      // Initialize edit values
      const values: Record<string, string> = {};
      (data || []).forEach((s: ApiKeySetting) => {
        values[s.key] = s.value || '';
      });
      setEditValues(values);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (key: string) => {
    setIsSaving(key);
    try {
      const existingSetting = settings.find((s) => s.key === key);
      const value = editValues[key] || null;

      if (existingSetting) {
        const { error } = await supabase
          .from('admin_settings')
          .update({ value, is_active: !!value })
          .eq('key', key);

        if (error) throw error;
      } else {
        const config = API_KEY_CONFIGS.find((c) => c.key === key);
        const { error } = await supabase
          .from('admin_settings')
          .insert({
            key,
            value,
            is_active: !!value,
            description: config?.description || null,
          });

        if (error) throw error;
      }

      toast.success('Setting saved');
      await fetchSettings();
    } catch (error) {
      console.error('Error saving setting:', error);
      toast.error('Failed to save setting');
    } finally {
      setIsSaving(null);
    }
  };

  const toggleActive = async (key: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('admin_settings')
        .update({ is_active: isActive })
        .eq('key', key);

      if (error) throw error;
      await fetchSettings();
      toast.success(isActive ? 'Enabled' : 'Disabled');
    } catch (error) {
      console.error('Error toggling setting:', error);
      toast.error('Failed to update setting');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Key size={16} className="text-amber-600" />
          </div>
          API Configuration
        </CardTitle>
        <CardDescription className="text-xs">
          Configure third-party API keys for enhanced features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {API_KEY_CONFIGS.map((config) => {
          const setting = settings.find((s) => s.key === config.key);
          const hasValue = !!setting?.value;
          const isActive = setting?.is_active ?? false;

          return (
            <div key={config.key} className="space-y-2.5 p-3.5 rounded-xl bg-muted/30 border border-border/40">
              <div className="flex items-center justify-between">
                <Label htmlFor={config.key} className="font-semibold text-sm">
                  {config.label}
                </Label>
                {hasValue && (
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-0.5">
                        <Check size={10} /> Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] gap-0.5">
                        <X size={10} /> Inactive
                      </Badge>
                    )}
                    <Switch
                      checked={isActive}
                      onCheckedChange={(checked) => toggleActive(config.key, checked)}
                    />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{config.description}</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id={config.key}
                    type={showValues[config.key] ? 'text' : 'password'}
                    placeholder={config.placeholder}
                    value={editValues[config.key] || ''}
                    onChange={(e) =>
                      setEditValues({ ...editValues, [config.key]: e.target.value })
                    }
                    className="rounded-lg pr-9"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowValues({ ...showValues, [config.key]: !showValues[config.key] })
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showValues[config.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <Button
                  onClick={() => handleSave(config.key)}
                  disabled={isSaving === config.key}
                  size="sm"
                  className="rounded-lg"
                >
                  {isSaving === config.key ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </div>
          );
        })}

        <div className="pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            🔒 API keys are encrypted and stored securely. They are only used for the specified features.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
