// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Settings, Save, Loader2, RefreshCw, IndianRupee, Mail, Type, Percent, FileText, Info, Activity, MapPin, Users, TrendingUp } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'textarea';
  icon: React.ElementType;
  group: string;
  description: string;
}

const SETTING_FIELDS: SettingField[] = [
  // ── Financial ──
  { key: 'base_delivery_fee', label: 'Base Delivery Fee', type: 'number', icon: IndianRupee, group: 'Financial', description: 'Charged when order is below free delivery threshold' },
  { key: 'free_delivery_threshold', label: 'Free Delivery Threshold', type: 'number', icon: IndianRupee, group: 'Financial', description: 'Orders above this amount get free delivery' },
  { key: 'platform_fee_percent', label: 'Platform Fee (%)', type: 'number', icon: Percent, group: 'Financial', description: 'Commission deducted from seller earnings' },
  // ── Contact ──
  { key: 'support_email', label: 'Support Email', type: 'email', icon: Mail, group: 'Contact', description: 'Shown on Terms & Pricing pages' },
  { key: 'grievance_email', label: 'Grievance Email', type: 'email', icon: Mail, group: 'Contact', description: 'Shown on Help & Grievance Officer section' },
  { key: 'dpo_email', label: 'DPO Email', type: 'email', icon: Mail, group: 'Contact', description: 'Data Protection Officer email on Privacy Policy' },
  { key: 'grievance_officer_name', label: 'Grievance Officer Name', type: 'text', icon: Type, group: 'Contact', description: 'Displayed in the Grievance Officer card' },
  // ── Branding ──
  { key: 'header_tagline', label: 'Header Tagline', type: 'text', icon: Type, group: 'Branding', description: 'Shown below the logo in the app header' },
  { key: 'app_version', label: 'App Version', type: 'text', icon: Settings, group: 'Branding', description: 'Displayed on the Profile page' },
  // ── Address ──
  { key: 'address_block_label', label: 'Address Block Label', type: 'text', icon: Type, group: 'Address', description: 'Label for block/tower field (e.g., Block / Tower, Wing)' },
  { key: 'address_flat_label', label: 'Address Flat Label', type: 'text', icon: Type, group: 'Address', description: 'Label for flat/unit field (e.g., Flat Number, Unit)' },
  // ── Legal ──
  { key: 'terms_last_updated', label: 'Terms Last Updated', type: 'text', icon: Type, group: 'Legal', description: 'Date shown on Terms & Conditions page' },
  { key: 'privacy_last_updated', label: 'Privacy Last Updated', type: 'text', icon: Type, group: 'Legal', description: 'Date shown on Privacy Policy page' },
  { key: 'terms_content_md', label: 'Terms & Conditions Content', type: 'textarea', icon: FileText, group: 'Legal CMS', description: 'Plain text content for Terms page. Leave empty to use default template.' },
  { key: 'privacy_content_md', label: 'Privacy Policy Content', type: 'textarea', icon: FileText, group: 'Legal CMS', description: 'Plain text content for Privacy page. Leave empty to use default template.' },
  { key: 'help_sections_json', label: 'Help Sections (JSON)', type: 'textarea', icon: FileText, group: 'Help CMS', description: 'JSON array: [{"icon":"ShoppingBag","title":"How to Order","items":["Step 1","Step 2"]}]. Leave empty for defaults.' },
  // ── Trust & Guarantee Branding ──
  { key: 'label_checkout_community_support', label: 'Community Support Text', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'Format: {count} and {suffix} placeholders' },
  { key: 'label_checkout_community_emoji', label: 'Community Emoji', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'Emoji shown in checkout footer' },
  { key: 'label_neighborhood_guarantee', label: 'Guarantee Title', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'e.g. "Neighborhood Guarantee"' },
  { key: 'label_neighborhood_guarantee_desc', label: 'Guarantee Description', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'Shown on dispute sheets' },
  { key: 'label_neighborhood_guarantee_badge', label: 'Guarantee Badge Text', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'Shown on cart page' },
  { key: 'label_neighborhood_guarantee_emoji', label: 'Guarantee Emoji', type: 'text', icon: Type, group: 'Trust & Guarantee Branding', description: 'e.g. 🛡️' },
  // ── Marketplace Policy ──
  { key: 'on_time_badge_min_orders', label: 'On-time Badge Min Orders', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Minimum orders to show on-time badge' },
  { key: 'stable_price_days', label: 'Stable Price Days', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Days of unchanged price for "Stable Price" badge' },
  { key: 'new_this_week_days', label: 'New This Week Days', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Cutoff for "new this week" discovery' },
  { key: 'discovery_min_products', label: 'Discovery Min Products', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Min products to show discovery row' },
  { key: 'discovery_max_items', label: 'Discovery Max Items', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Max items per discovery row' },
  { key: 'demand_insights_max_items', label: 'Demand Insights Max Items', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Max items shown in demand insights' },
  { key: 'price_history_max_points', label: 'Price History Max Points', type: 'number', icon: Settings, group: 'Marketplace Policy', description: 'Max data points on price sparkline' },
  // ── Dispute Configuration ──
  { key: 'dispute_sla_warning_hours', label: 'Dispute SLA Warning Hours', type: 'number', icon: Settings, group: 'Dispute Configuration', description: 'Hours before SLA warning appears' },
  { key: 'label_dispute_sla_notice', label: 'Dispute SLA Notice', type: 'text', icon: Type, group: 'Dispute Configuration', description: 'e.g. "The committee will review within 48 hours."' },
  { key: 'dispute_categories_json', label: 'Dispute Categories', type: 'textarea', icon: FileText, group: 'Dispute Configuration', description: 'JSON array: [{"value":"noise","label":"Noise"}]' },
];

/* ── System Signals (read-only informational) ── */
const SYSTEM_SIGNALS = [
  { icon: Activity, title: 'Seller Activity', description: 'Automatically computed from last login/order timestamp. Shows "Active now", "Xh ago", or "Yesterday".' },
  { icon: MapPin, title: 'Proximity & Distance', description: 'Calculated from GPS coordinates. Displays "In your society", "Xm away", or "X km away" automatically.' },
  { icon: Users, title: 'Social Proof', description: 'Derived from order data via get_society_order_stats. Shows "X families ordered this week".' },
  { icon: TrendingUp, title: 'On-time Delivery %', description: 'Computed from the seller fulfillment ledger. Badge appears after min-order threshold (configurable above).' },
  { icon: Info, title: 'Stable Price Badge', description: 'System checks price_history table. Badge appears when price is unchanged for the configured number of days.' },
];

export function PlatformSettingsManager() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', SETTING_FIELDS.map(f => f.key));

    const map: Record<string, string> = {};
    for (const row of data || []) {
      if (row.key && row.value) map[row.key] = row.value;
    }
    setValues(map);
    setOriginal(map);
    setLoading(false);
  };

  const changedKeys = Object.keys(values).filter(k => values[k] !== original[k]);
  const hasChanges = changedKeys.length > 0;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      for (const key of changedKeys) {
        // Upsert: update if exists, insert if not
        const { data: existing } = await supabase
          .from('system_settings')
          .select('key')
          .eq('key', key)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('system_settings')
            .update({ value: values[key], updated_at: new Date().toISOString() })
            .eq('key', key);
        } else {
          await supabase
            .from('system_settings')
            .insert({ key, value: values[key] });
        }
      }
      setOriginal({ ...values });
      queryClient.invalidateQueries({ queryKey: ['system-settings-all'] });
      toast.success(`${changedKeys.length} setting(s) updated`);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const groups = [...new Set(SETTING_FIELDS.map(f => f.group))];

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Settings size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Platform Settings</h3>
              <p className="text-[10px] text-muted-foreground">Configure global platform behavior</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-8 text-xs rounded-lg" onClick={fetchSettings}>
              <RefreshCw size={12} className="mr-1" /> Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs rounded-lg"
              disabled={!hasChanges || saving}
              onClick={handleSave}
            >
              {saving ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Save size={12} className="mr-1" />}
              Save {hasChanges ? `(${changedKeys.length})` : ''}
            </Button>
          </div>
        </div>

        {groups.map((group, gi) => (
          <div key={group}>
            {gi > 0 && <Separator className="my-4" />}
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              {group}
            </p>
            <div className="space-y-4">
              {SETTING_FIELDS.filter(f => f.group === group).map(field => {
                const Icon = field.icon;
                const isChanged = values[field.key] !== original[field.key];
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Icon size={12} className="text-muted-foreground" />
                      {field.label}
                      {isChanged && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                          modified
                        </Badge>
                      )}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="text-sm min-h-[80px] rounded-xl"
                        placeholder={field.description}
                        rows={4}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="h-9 text-sm rounded-xl"
                        placeholder={field.description}
                      />
                    )}
                    <p className="text-[10px] text-muted-foreground">{field.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <Separator className="my-4" />
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          System Signals (Auto-computed)
        </p>
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 space-y-3">
          <p className="text-[10px] text-muted-foreground">
            These trust indicators are computed automatically by the platform. No configuration needed.
          </p>
          {SYSTEM_SIGNALS.map(signal => {
            const Icon = signal.icon;
            return (
              <div key={signal.title} className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon size={12} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs font-medium">{signal.title}</p>
                  <p className="text-[10px] text-muted-foreground">{signal.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
