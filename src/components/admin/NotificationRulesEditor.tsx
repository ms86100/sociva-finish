// @ts-nocheck
import { useState } from 'react';
import { useNotificationRules, useUpdateNotificationRule } from '@/hooks/useNotificationRules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function NotificationRulesEditor() {
  const { data: rules, isLoading } = useNotificationRules();
  const update = useUpdateNotificationRule();
  const [drafts, setDrafts] = useState<Record<string, { delay_seconds?: number; repeat_interval_seconds?: number | null; max_repeats?: number }>>({});

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading rules…</div>;
  }

  const grouped: Record<string, typeof rules> = {};
  for (const r of rules || []) {
    const k = `${r.entity_type} · ${r.trigger_status}`;
    (grouped[k] ||= []).push(r);
  }

  const handleSave = async (id: string) => {
    const patch = drafts[id];
    if (!patch) return;
    try {
      await update.mutateAsync({ id, patch });
      toast.success('Rule updated');
      setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    } catch (e: any) {
      toast.error(e.message || 'Update failed');
    }
  };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([group, items]) => (
        <div key={group} className="rounded-xl border border-border/40 p-4">
          <h3 className="text-sm font-semibold mb-3">{group}</h3>
          <div className="space-y-2">
            {items!.map((r) => {
              const draft = drafts[r.id] || {};
              const delay = draft.delay_seconds ?? r.delay_seconds;
              const repeat = draft.repeat_interval_seconds ?? r.repeat_interval_seconds;
              const max = draft.max_repeats ?? r.max_repeats;
              const dirty = drafts[r.id] !== undefined;
              return (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center text-xs p-2 rounded-lg bg-muted/30">
                  <div className="col-span-3">
                    <div className="font-medium">{r.key}</div>
                    <div className="text-muted-foreground">L{r.escalation_level} · {r.target_actor}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-muted-foreground mb-1">Delay (sec)</label>
                    <Input type="number" value={delay} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], delay_seconds: Number(e.target.value) } }))} className="h-7 text-xs" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-muted-foreground mb-1">Repeat (sec)</label>
                    <Input type="number" value={repeat ?? ''} placeholder="—" onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], repeat_interval_seconds: e.target.value === '' ? null : Number(e.target.value) } }))} className="h-7 text-xs" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] text-muted-foreground mb-1">Max</label>
                    <Input type="number" value={max} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], max_repeats: Number(e.target.value) } }))} className="h-7 text-xs" />
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <Switch checked={r.active} onCheckedChange={(v) => update.mutate({ id: r.id, patch: { active: v } })} />
                    <Badge variant={r.active ? 'default' : 'secondary'} className="text-[10px]">{r.active ? 'On' : 'Off'}</Badge>
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {dirty && <Button size="sm" className="h-7 text-xs" onClick={() => handleSave(r.id)} disabled={update.isPending}>Save</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
