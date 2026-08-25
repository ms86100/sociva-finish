// @ts-nocheck
import { useState, useMemo } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Megaphone, Loader2, AlertTriangle } from 'lucide-react';
import { adminNotify } from '@/lib/admin-notify';
import { friendlyError } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

const BROADCAST_CATEGORIES = [
  { value: 'water_shutdown', label: '💧 Water Shutdown', emoji: '💧' },
  { value: 'power_outage', label: '⚡ Power Outage', emoji: '⚡' },
  { value: 'security_alert', label: '🚨 Security Alert', emoji: '🚨' },
  { value: 'maintenance', label: '🔧 Maintenance', emoji: '🔧' },
  { value: 'fire_drill', label: '🔥 Fire Drill', emoji: '🔥' },
  { value: 'general', label: '📢 General', emoji: '📢' },
];

function isIntegrationTestSociety(name?: string | null) {
  return !!name && /^Integration Test Society/i.test(name.trim());
}

export function EmergencyBroadcastSheet() {
  const { user, profile, viewAsSocietyId, effectiveSociety } = useAuth();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [category, setCategory] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // For broadcasts, use the viewed society (admin intent) or fall back to own society
  const targetSocietyId = viewAsSocietyId || profile?.society_id;

  const { data: targetSocietyMeta } = useQuery({
    queryKey: ['broadcast-target-society', targetSocietyId],
    enabled: !!targetSocietyId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('societies')
        .select('id, name')
        .eq('id', targetSocietyId!)
        .maybeSingle();
      if (error) throw error;
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', targetSocietyId!);
      return { name: data?.name || effectiveSociety?.name || 'Selected society', residents: count || 0 };
    },
    staleTime: 30_000,
  });

  const societyLabel = targetSocietyMeta?.name || effectiveSociety?.name || null;
  const isTestTarget = useMemo(
    () => isIntegrationTestSociety(societyLabel),
    [societyLabel],
  );

  const handleSend = async () => {
    if (!user) return;
    if (!targetSocietyId) {
      adminNotify.error('Select a society first (admin society switcher), then send the broadcast.');
      return;
    }
    if (!title.trim() || !body.trim()) return;
    setSending(true);

    try {
      const cat = BROADCAST_CATEGORIES.find(c => c.value === category);
      const emoji = cat?.emoji || '📢';

      const { data, error } = await supabase.rpc('admin_send_emergency_broadcast', {
        p_society_id: targetSocietyId,
        p_category: category,
        p_title: `${emoji} ${title.trim()}`,
        p_body: body.trim(),
      });

      if (error) throw error;

      const notified = Number((data as any)?.notified_count ?? 0);
      try {
        await supabase.functions.invoke('process-notification-queue');
      } catch (e) {
        console.warn('Broadcast queued; PNQ trigger deferred to cron:', e);
      }

      adminNotify.success(
        notified > 0
          ? `Broadcast sent to ${notified} resident${notified === 1 ? '' : 's'} in ${societyLabel || 'the society'}`
          : `Broadcast saved for ${societyLabel || 'society'} — no residents found to notify`,
      );
      setTitle('');
      setBody('');
      setCategory('general');
      setOpen(false);
    } catch (err: any) {
      const raw = err?.message || String(err || '');
      if (/check|type|violates/i.test(raw)) {
        adminNotify.error('That broadcast category is not allowed. Pick another category and try again.');
      } else {
        adminNotify.error(friendlyError(err));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-1.5">
          <Megaphone size={14} />
          Emergency Broadcast
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive" size={18} />
            Emergency Broadcast
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Pushes go to residents of the society selected in the admin society switcher.
          </p>
          {!targetSocietyId ? (
            <p className="text-xs text-destructive font-medium">
              Select a society in the header switcher before sending.
            </p>
          ) : (
            <p className="text-xs font-medium">
              Target: <span className="text-foreground">{societyLabel || 'Selected society'}</span>
              {typeof targetSocietyMeta?.residents === 'number' && (
                <span className="text-muted-foreground font-normal"> · {targetSocietyMeta.residents} resident{targetSocietyMeta.residents === 1 ? '' : 's'}</span>
              )}
            </p>
          )}
          {isTestTarget && (
            <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              This is an integration-test society (seed data). Real community societies must be created/verified under Admin → Societies, then residents join at signup.
            </p>
          )}
        </div>
        <div className="space-y-4 px-4 pb-6 pt-3">
          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BROADCAST_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Water supply disruption in Tower B"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Message *</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Provide details — timing, affected areas, expected resolution..."
              rows={4}
            />
          </div>
          <Button
            variant="destructive"
            onClick={handleSend}
            disabled={sending || !title.trim() || !body.trim() || !targetSocietyId}
            className="w-full"
          >
            {sending ? <Loader2 className="animate-spin mr-2" size={16} /> : <Megaphone size={16} className="mr-2" />}
            Send to All Residents
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
