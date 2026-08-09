// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { notifySocietyMembers } from '@/lib/society-notifications';
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
    if (!user || !targetSocietyId || !title.trim() || !body.trim()) return;
    setSending(true);

    try {
      const cat = BROADCAST_CATEGORIES.find(c => c.value === category);
      const emoji = cat?.emoji || '📢';

      // Save to database — use the target society
      const { error } = await supabase.from('emergency_broadcasts').insert({
        society_id: targetSocietyId,
        sender_id: user.id,
        sent_by: user.id,
        type: category,
        category,
        title: title.trim(),
        message: body.trim(),
        body: body.trim(),
      } as any);

      if (error) throw error;

      // Send push to ALL members of the target society (routes through notification queue)
      await notifySocietyMembers(
        targetSocietyId,
        `${emoji} ${title.trim()}`,
        body.trim(),
        { type: 'broadcast', category },
        undefined,
        { includeUnapproved: true }
      );

      adminNotify.success('Broadcast sent to all residents');
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
        <p className="text-xs text-muted-foreground mt-1">
          This will send a push notification to ALL residents in {viewAsSocietyId ? 'the selected' : 'your'} society.
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
            disabled={sending || !title.trim() || !body.trim()}
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
