// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { notifySocietyMembers } from '@/lib/society-notifications';
import { friendlyError } from '@/lib/utils';

interface Tower {
  id: string;
  name: string;
}

interface AddMilestoneSheetProps {
  onAdded: () => void;
  towers?: Tower[];
}

export function AddMilestoneSheet({ onAdded, towers = [] }: AddMilestoneSheetProps) {
  const { user, profile, viewAsSocietyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState('foundation');
  const [completion, setCompletion] = useState([0]);
  const [towerId, setTowerId] = useState<string>('none');

  const handleSubmit = async () => {
    if (!user || !profile?.society_id || !title.trim()) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('construction_milestones')
        .insert({
          society_id: profile.society_id,
          title: title.trim(),
          description: description.trim() || null,
          stage,
          completion_percentage: completion[0],
          posted_by: user.id,
          tower_id: towerId === 'none' ? null : towerId,
        });

      if (error) throw error;

      // Notify society members
      if (profile.society_id) {
        notifySocietyMembers(
          profile.society_id,
          '🏗 Construction Update',
          `${title.trim()} — ${completion[0]}% complete`,
          { type: 'milestone' },
          user.id
        );
      }

      toast.success('Milestone added! Your entry will appear in the timeline.');
      setTitle('');
      setDescription('');
      setStage('foundation');
      setCompletion([0]);
      setTowerId('none');
      setOpen(false);
      onAdded();
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus size={14} /> Add Milestone
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>Add Construction Milestone</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 mt-4">
          {towers.length > 0 && (
            <div>
              <label className="text-sm font-medium">Tower (optional)</label>
              <Select value={towerId} onValueChange={setTowerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All / General</SelectItem>
                  {towers.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., 14th Floor Slab Poured"
            />
          </div>
          <div>
            <label className="text-sm font-medium">RERA Stage</label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="foundation">Foundation</SelectItem>
                <SelectItem value="structure">Structure</SelectItem>
                <SelectItem value="mep">MEP Works</SelectItem>
                <SelectItem value="finishing">Finishing</SelectItem>
                <SelectItem value="handover">Handover</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Completion: {completion[0]}%</label>
            <Slider
              value={completion}
              onValueChange={setCompletion}
              min={0}
              max={100}
              step={5}
              className="mt-2"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this milestone update..."
              rows={3}
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !!viewAsSocietyId}
            className="w-full"
          >
            {isSubmitting ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            Post Milestone
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
