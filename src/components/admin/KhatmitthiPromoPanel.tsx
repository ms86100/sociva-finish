import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { adminNotify } from '@/lib/admin-notify';
import {
  mergeKhatmitthiPromoConfig,
  type PromoMode,
} from '@/lib/khatmitthi-promo';
import { Loader2, MessageCircleHeart } from 'lucide-react';

type RunRow = {
  id: string;
  started_at: string;
  status: string;
  mode: string | null;
  angle: string | null;
  headline: string | null;
  caption: string | null;
  product_name: string | null;
  creative_image_url: string | null;
  image_source: string | null;
  skip_reason: string | null;
  error_message: string | null;
  dry_run: boolean | null;
};

export function KhatmitthiPromoPanel() {
  const [mode, setMode] = useState<PromoMode>('shadow');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<'dry' | 'force' | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [preview, setPreview] = useState('');

  const load = useCallback(async () => {
    const [{ data: cfg }, { data: history }] = await Promise.all([
      supabase.from('notification_config' as any).select('value').eq('key', 'khatmitthi_whatsapp_promo').maybeSingle(),
      supabase
        .from('khatmitthi_promo_runs' as any)
        .select(
          'id, started_at, status, mode, angle, headline, caption, product_name, creative_image_url, image_source, skip_reason, error_message, dry_run',
        )
        .order('started_at', { ascending: false })
        .limit(12),
    ]);
    setMode(mergeKhatmitthiPromoConfig((cfg as any)?.value).mode);
    setRuns((history || []) as RunRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMode(next: PromoMode) {
    setSaving(true);
    try {
      const { data: cfg } = await supabase
        .from('notification_config' as any)
        .select('value')
        .eq('key', 'khatmitthi_whatsapp_promo')
        .maybeSingle();
      const merged = mergeKhatmitthiPromoConfig((cfg as any)?.value);
      const value = { ...merged, mode: next, provider: 'evolution_go' };
      const { error } = await supabase
        .from('notification_config' as any)
        .upsert({ key: 'khatmitthi_whatsapp_promo', value, updated_at: new Date().toISOString() });
      if (error) throw error;
      setMode(next);
      adminNotify.success(`Khatmitthi WhatsApp promo is now ${next}`);
    } catch (e) {
      adminNotify.error(e instanceof Error ? e.message : 'Could not update mode');
    } finally {
      setSaving(false);
    }
  }

  async function runPromo(kind: 'dry' | 'force') {
    setRunning(kind);
    setPreview('');
    try {
      const { data, error } = await supabase.functions.invoke('send-khatmitthi-promo', {
        body: kind === 'dry' ? { dry_run: true, force: true } : { force: true },
      });
      if (error) throw error;
      setPreview(JSON.stringify(data, null, 2));
      if ((data as any)?.ok) {
        adminNotify.success(kind === 'dry' ? 'Dry run ready' : 'Promo run finished');
      } else {
        adminNotify.error((data as any)?.error || 'Promo run failed');
      }
      await load();
    } catch (e) {
      adminNotify.error(e instanceof Error ? e.message : 'Promo run failed');
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <MessageCircleHeart size={16} className="text-primary" />
          Khatmitthi WhatsApp autopilot
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Every 40 minutes (Asia/Kolkata): fresh caption + creative to your WhatsApp inbox for forwarding.
          Meta Cloud API only. Quiet hours 12:00 AM - 7:00 AM IST. Default mode is shadow.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Mode</Label>
            <Select value={mode} onValueChange={(v) => void saveMode(v as PromoMode)} disabled={saving}>
              <SelectTrigger className="w-44 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="shadow">Shadow (generate only)</SelectItem>
                <SelectItem value="live">Live (send WhatsApp)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!!running}
            onClick={() => void runPromo('dry')}
          >
            {running === 'dry' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Dry run'}
          </Button>
          <Button
            className="rounded-xl"
            disabled={!!running || mode !== 'live'}
            onClick={() => void runPromo('force')}
          >
            {running === 'force' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send now'}
          </Button>
        </div>

        <div className="rounded-xl bg-muted/40 p-3 text-[11px] text-muted-foreground space-y-1">
          <p>Recipients: +91 9535115316, +91 9187351014 (operator inbox only - no group broadcast).</p>
          <p>Offer locked: FLAT 50% OFF · Coupon KHATMITTHI50 · Prefer real Khatmitthi product photos when available.</p>
          <p>
            Meta note: free-form image+caption needs a 24h customer-service window, or an approved marketing
            template. Message Sociva WhatsApp (+91 9902920804) from each inbox number first if sends fail.
          </p>
        </div>

        {preview ? (
          <pre className="max-h-64 overflow-auto rounded-xl bg-muted/50 p-3 text-[10px] leading-relaxed">
            {preview}
          </pre>
        ) : null}

        <div className="space-y-2">
          <Label className="text-xs font-semibold">Recent runs</Label>
          <div className="space-y-2">
            {runs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No runs yet.</p>
            ) : (
              runs.map((r) => (
                <div key={r.id} className="rounded-xl border border-border/60 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-lg text-[10px]">{r.status}</Badge>
                    {r.angle ? <Badge variant="outline" className="rounded-lg text-[10px]">{r.angle}</Badge> : null}
                    {r.image_source ? (
                      <Badge variant="outline" className="rounded-lg text-[10px]">{r.image_source}</Badge>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(r.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </span>
                  </div>
                  <p className="text-xs font-medium">{r.headline || r.product_name || 'Creative'}</p>
                  {r.creative_image_url ? (
                    <img
                      src={r.creative_image_url}
                      alt={r.product_name || 'Khatmitthi promo'}
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  ) : null}
                  {r.caption ? (
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-4">{r.caption}</p>
                  ) : null}
                  {r.error_message || r.skip_reason ? (
                    <p className="text-[11px] text-destructive">{r.error_message || r.skip_reason}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
