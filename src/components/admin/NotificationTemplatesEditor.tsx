// @ts-nocheck
import { useState } from 'react';
import { useNotificationTemplates, useUpdateNotificationTemplate } from '@/hooks/useNotificationTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function NotificationTemplatesEditor() {
  const { data: templates, isLoading } = useNotificationTemplates();
  const update = useUpdateNotificationTemplate();
  const [drafts, setDrafts] = useState<Record<string, { title_template?: string; body_template?: string }>>({});

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>;
  }

  const handleSave = async (id: string) => {
    const patch = drafts[id];
    if (!patch) return;
    try {
      await update.mutateAsync({ id, patch });
      toast.success('Template saved');
      setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    }
  };

  return (
    <div className="space-y-3">
      {(templates || []).map((t) => {
        const draft = drafts[t.id] || {};
        const title = draft.title_template ?? t.title_template;
        const body = draft.body_template ?? t.body_template;
        const dirty = drafts[t.id] !== undefined;
        const toneVariant = t.tone === 'urgent' ? 'destructive' : t.tone === 'warning' ? 'secondary' : 'outline';
        return (
          <div key={t.id} className="rounded-xl border border-border/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs font-medium truncate">{t.key}</code>
                <Badge variant={toneVariant as any} className="text-[10px]">{t.tone}</Badge>
                <Badge variant="outline" className="text-[10px]">{t.channel}</Badge>
              </div>
              <Switch checked={t.active} onCheckedChange={(v) => update.mutate({ id: t.id, patch: { active: v } })} />
            </div>
            <Input value={title} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: { ...d[t.id], title_template: e.target.value } }))} className="h-8 text-xs" />
            <Textarea value={body} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: { ...d[t.id], body_template: e.target.value } }))} className="text-xs min-h-[60px]" />
            {dirty && (
              <div className="flex justify-end">
                <Button size="sm" className="h-7 text-xs" onClick={() => handleSave(t.id)} disabled={update.isPending}>Save</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
