// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Plus, Trash2 } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function WorkerCategoryManager() {
  const { effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('👤');
  const [entryType, setEntryType] = useState('daily');
  const [bgCheck, setBgCheck] = useState(false);
  const [secTraining, setSecTraining] = useState(false);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['worker-categories', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('society_worker_categories')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .order('display_order');
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const handleAdd = async () => {
    if (!name.trim() || !effectiveSocietyId) return;
    const { error } = await supabase.from('society_worker_categories').insert({
      society_id: effectiveSocietyId,
      name: name.trim(),
      icon,
      entry_type: entryType,
      requires_background_check: bgCheck,
      requires_security_training: secTraining,
      display_order: categories.length,
    });
    if (error) {
      toast.error(error.code === '23505' ? 'Category already exists' : 'Failed to add');
    } else {
      toast.success('Category added');
      queryClient.invalidateQueries({ queryKey: ['worker-categories'] });
      setIsOpen(false);
      setName(''); setIcon('👤'); setEntryType('daily');
      setBgCheck(false); setSecTraining(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('society_worker_categories').delete().eq('id', id);
    if (!error) {
      toast.success('Category removed');
      queryClient.invalidateQueries({ queryKey: ['worker-categories'] });
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from('society_worker_categories').update({ is_active: isActive }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['worker-categories'] });
  };

  const EMOJI_PRESETS = ['🧹', '👨‍🍳', '🚗', '👶', '🌱', '🔧', '⚡', '❄️', '🔨', '🛠️', '👷', '🧑‍🔧', '👤', '📦'];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Worker Categories</h3>
        <Drawer open={isOpen} onOpenChange={setIsOpen}>
          <DrawerTrigger asChild>
            <Button size="sm" variant="outline"><Plus size={14} className="mr-1" /> Add</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader><DrawerTitle>Add Worker Category</DrawerTitle></DrawerHeader>
            <div className="space-y-4 px-4 pb-6">
              <div>
                <Label>Category Name *</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. AC Technician" />
              </div>
              <div>
                <Label className="mb-2 block">Icon</Label>
                <div className="flex gap-1 flex-wrap">
                  {EMOJI_PRESETS.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setIcon(e)}
                      className={`w-10 h-10 rounded-lg text-lg flex items-center justify-center ${icon === e ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Entry Type</Label>
                <Select value={entryType} onValueChange={setEntryType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily (recurring)</SelectItem>
                    <SelectItem value="shift">Shift-based</SelectItem>
                    <SelectItem value="per_visit">Per Visit (approval needed)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={bgCheck} onCheckedChange={setBgCheck} />
                <Label>Requires Background Check</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={secTraining} onCheckedChange={setSecTraining} />
                <Label>Requires Security Training</Label>
              </div>
              <Button onClick={handleAdd} disabled={!name.trim()} className="w-full">Add Category</Button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {categories.map(cat => (
        <Card key={cat.id}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DynamicIcon name={cat.icon} size={20} />
              <div>
                <p className="font-medium text-sm">{cat.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{cat.entry_type.replace('_', ' ')} entry</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {cat.requires_background_check && <Badge variant="outline" className="text-[10px]">BG Check</Badge>}
              <Switch
                checked={cat.is_active}
                onCheckedChange={(v) => handleToggle(cat.id, v)}
              />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(cat.id)}>
                <Trash2 size={12} />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {categories.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground py-6">
          No custom categories. Default types will be used.
        </p>
      )}
    </div>
  );
}
