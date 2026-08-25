// @ts-nocheck
import { useState } from 'react';
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

const BROADCAST_CATEGORIES = [
  { value: 'water_shutdown', label: '💧 Water Shutdown', emoji: '💧' },
  { value: 'power_outage', label: '⚡ Power Outage', emoji: '⚡' },
  { value: 'security_alert', label: '🚨 Security Alert', emoji: '🚨' },
  { value: 'maintenance', label: '🔧 Maintenance', emoji: '🔧' },
  { value: 'fire_drill', label: '🔥 Fire Drill', emoji: '🔥' },
  { value: 'general', label: '📢 General', emoji: '📢' },
];

export function EmergencyBroadcastSheet() {
  const { user, profile, viewAsSocietyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [category, setCategory] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // For broadcasts, use the viewed society (admin intent) or fall back to own society
  const targetSocietyId = viewAsSocietyId || profile?.society_id;

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

      // SECURITY DEFINER RPC: inserts broadcast + enqueues pushes for all residents
      // (client notification_queue RLS only allows user_id = auth.uid())
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
          ? `Broadcast sent to ${notified} resident${notified === 1 ? '' : 's'}`
          : 'Broadcast saved — no residents found in this society',
      );
      setTitle('');
      setBody('');
      setCategory('general');
      setOpen(false);
    } catch (err: any) {
      adminNotify.error(friendlyError(err));
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
        <p className="text-xs text-muted-foreground mt-1 px-4">
          This will send a push notification to ALL residents in {viewAsSocietyId ? 'the selected' : 'your'} society.
          {!targetSocietyId && (
            <span className="block text-destructive mt-1">Select a society in the admin switcher before sending.</span>
          )}
        </p>
        <div className="space-y-4 px-4 pb-6">
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
