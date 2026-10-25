import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { adminNotify } from '@/lib/admin-notify';
import {
  FOOD_DISCOVERY_FRAMES,
  mergeFoodDiscoveryConfig,
  unicodeLen,
  type DiscoveryMode,
  type MealSlot,
} from '@/lib/food-discovery';
import { Loader2, UtensilsCrossed } from 'lucide-react';

type RunRow = {
  id: string;
  ist_date: string;
  slot: string;
  status: string;
  mode: string | null;
  title: string | null;
  body: string | null;
  destination: string | null;
  seller_id: string | null;
  skip_reason: string | null;
  queued_count: number | null;
  started_at: string;
};

export function FoodDiscoveryPanel() {
  const [mode, setMode] = useState<DiscoveryMode>('shadow');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<MealSlot | 'all' | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [preview, setPreview] = useState<string>('');

  const load = useCallback(async () => {
    const [{ data: cfg }, { data: history }] = await Promise.all([
      supabase.from('notification_config' as any).select('value').eq('key', 'food_discovery').maybeSingle(),
      supabase
        .from('food_discovery_runs' as any)
        .select('id, ist_date, slot, status, mode, title, body, destination, seller_id, skip_reason, queued_count, started_at')
        .order('started_at', { ascending: false })
        .limit(14),
    ]);
    const merged = mergeFoodDiscoveryConfig((cfg as any)?.value);
    setMode(merged.mode);
    setRuns((history || []) as RunRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMode(next: DiscoveryMode) {
    setSaving(true);
    try {
      const { data: cfg } = await supabase
        .from('notification_config' as any)
        .select('value')
        .eq('key', 'food_discovery')
        .maybeSingle();
      const merged = mergeFoodDiscoveryConfig((cfg as any)?.value);
      const value = { ...merged, mode: next };
      const { error } = await supabase
        .from('notification_config' as any)
        .upsert({ key: 'food_discovery', value, updated_at: new Date().toISOString() });
      if (error) throw error;
      setMode(next);
      adminNotify.success(`Food discovery is now ${next}`);
    } catch (e) {
      adminNotify.error(e instanceof Error ? e.message : 'Could not update mode');
    } finally {
      setSaving(false);
    }
  }

  async function dryRun(slot: MealSlot) {
    setRunning(slot);
    setPreview('');
    try {
      const { data, error } = await supabase.functions.invoke('send-food-discovery', {
        body: { slot, dry_run: true },
      });
      if (error) throw error;
      setPreview(JSON.stringify(data, null, 2));
      await load();
    } catch (e) {
      adminNotify.error(e instanceof Error ? e.message : 'Dry run failed');
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <UtensilsCrossed size={16} className="text-primary" />
          Daily food discovery
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Sends only when a neighbour kitchen can actually take the order. Breakfast 10:15, lunch 11:15, evening 17:30 IST.
          {` ${FOOD_DISCOVERY_FRAMES.length} voice frames in git. Default mode is shadow.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Mode</Label>
            <Select value={mode} onValueChange={(v) => void saveMode(v as DiscoveryMode)} disabled={saving}>
              <SelectTrigger className="w-40 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="shadow">Shadow (log only)</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(['breakfast', 'lunch', 'evening'] as MealSlot[]).map((slot) => (
            <Button
              key={slot}
              variant="outline"
              className="rounded-xl"
              disabled={!!running}
              onClick={() => void dryRun(slot)}
            >
              {running === slot ? <Loader2 className="h-4 w-4 animate-spin" /> : `Dry-run ${slot}`}
            </Button>
          ))}
        </div>

        {preview && (
          <pre className="text-[11px] bg-muted/40 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{preview}</pre>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold">Recent runs</p>
          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet. Shadow mode will log the first breakfast, lunch or evening selection.</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="rounded-xl border border-border/60 p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">{run.slot}</Badge>
                  <Badge variant={run.status === 'queued' ? 'default' : 'outline'}>{run.status}</Badge>
                  <span className="text-[11px] text-muted-foreground">{run.ist_date}</span>
                  {run.queued_count != null && (
                    <span className="text-[11px] text-muted-foreground">{run.queued_count} queued</span>
                  )}
                </div>
                {run.title && (
                  <p className="text-sm font-semibold">
                    {run.title}
                    <span className="text-[10px] text-muted-foreground font-normal ml-2">{unicodeLen(run.title)}/40</span>
                  </p>
                )}
                {run.body && <p className="text-xs text-muted-foreground">{run.body}</p>}
                {run.destination && <p className="text-[11px] font-mono">{run.destination}</p>}
                {run.skip_reason && <p className="text-xs text-amber-700">Skipped: {run.skip_reason}</p>}
              </div>
            ))
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Times and participating stores live in notification_config. Cron jobs can be paused from System. Live mode still respects promotion opt-outs, quiet hours and frequency caps.
        </p>
      </CardContent>
    </Card>
  );
}
