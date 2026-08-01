// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger
} from '@/components/ui/drawer';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Megaphone } from 'lucide-react';

interface Props {
  societies: { id: string; name: string }[];
  builderId: string;
  onSent?: () => void;
}

const CATEGORIES = [
  { value: 'update', label: '🏗️ Construction Update' },
  { value: 'delay', label: '⏰ Delay Notice' },
  { value: 'possession', label: '🏠 Possession Update' },
  { value: 'general', label: '📢 General Notice' },
];

export function BuilderAnnouncementSheet({ societies, builderId, onSent }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('update');
  const [societyId, setSocietyId] = useState(societies[0]?.id || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSend = async () => {
    if (!title.trim() || !body.trim() || !societyId || !user) return;
    setIsSubmitting(true);

    const { error } = await supabase.from('builder_announcements').insert({
      builder_id: builderId,
      society_id: societyId,
      title: title.trim(),
      body: body.trim(),
      category,
      posted_by: user.id,
    });

    if (error) {
      toast.error('Failed to send announcement');
      console.error(error);
    } else {
      toast.success('Announcement sent to all residents!');
      setTitle(''); setBody(''); setCategory('update');
      setOpen(false);
      onSent?.();
    }
    setIsSubmitting(false);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="sm" variant="outline">
          <Megaphone size={14} className="mr-1" /> Announce
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>Send Announcement</DrawerTitle>
          <DrawerDescription>Send an update to all residents of a society</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          {societies.length > 1 && (
            <div>
              <Label>Society</Label>
              <Select value={societyId} onValueChange={setSocietyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {societies.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Slab casting completed for Tower B" />
          </div>
          <div>
            <Label>Message *</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Detailed update for residents..." className="min-h-[100px]" />
          </div>
          <Button onClick={handleSend} disabled={!title.trim() || !body.trim() || isSubmitting} className="w-full">
            <Megaphone size={16} className="mr-2" />
            {isSubmitting ? 'Sending...' : 'Send to All Residents'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
