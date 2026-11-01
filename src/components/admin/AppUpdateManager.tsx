import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';

type Notice = {
  enabled: boolean;
  title: string;
  message: string;
  latest_version: string;
};

const EMPTY: Notice = {
  enabled: false,
  title: 'A better Sociva is ready',
  message: 'Update the app to see the latest menus, orders, and delivery updates.',
  latest_version: '',
};

export function AppUpdateManager() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Notice>(EMPTY);

  const query = useQuery({
    queryKey: ['admin-app-update-notice'],
    queryFn: async (): Promise<Notice> => {
      const { data, error } = await (supabase as any)
        .from('app_update_notices')
        .select('enabled, title, message, latest_version')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      const row = data as Partial<Notice> | null;
      return {
        enabled: row?.enabled ?? EMPTY.enabled,
        title: row?.title ?? EMPTY.title,
        message: row?.message ?? EMPTY.message,
        latest_version: row?.latest_version ?? '',
      };
    },
  });

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (next: Notice) => {
      const { error } = await (supabase as any)
        .from('app_update_notices')
        .update({
          enabled: next.enabled,
          title: next.title.trim(),
          message: next.message.trim(),
          latest_version: next.latest_version.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(draft.enabled ? 'App update message is on' : 'App update message is off');
      queryClient.invalidateQueries({ queryKey: ['admin-app-update-notice'] });
      queryClient.invalidateQueries({ queryKey: ['app-update-notice'] });
    },
    onError: () => {
      toast.error('Could not save the app update message');
    },
  });

  if (query.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">App Update</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Soft update banner on Home. Mandatory minimum versions stay under Platform Settings.
          When Latest version is set, the banner shows only on installs below that version.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
        <Label htmlFor="app-update-enabled">Show on Home</Label>
        <Switch
          id="app-update-enabled"
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="app-update-title">Title</Label>
        <Input
          id="app-update-title"
          value={draft.title}
          maxLength={80}
          onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="app-update-message">Message</Label>
        <Textarea
          id="app-update-message"
          value={draft.message}
          maxLength={240}
          rows={4}
          onChange={(event) => setDraft((prev) => ({ ...prev, message: event.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="app-update-latest">Latest version (optional)</Label>
        <Input
          id="app-update-latest"
          value={draft.latest_version}
          placeholder="e.g. 2.0.90"
          maxLength={32}
          onChange={(event) => setDraft((prev) => ({ ...prev, latest_version: event.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to show to everyone when enabled. Dismiss remembers this version so it does not reappear.
        </p>
      </div>
      <Button
        disabled={save.isPending || !draft.title.trim() || !draft.message.trim()}
        onClick={() => save.mutate(draft)}
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
      </Button>
    </div>
  );
}
