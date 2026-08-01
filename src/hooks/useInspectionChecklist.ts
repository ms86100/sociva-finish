// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface InspectionChecklist {
  id: string;
  flat_number: string;
  inspection_date: string | null;
  status: string;
  overall_score: number;
  total_items: number;
  passed_items: number;
  failed_items: number;
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface InspectionItem {
  id: string;
  checklist_id: string;
  category: string;
  item_name: string;
  description: string | null;
  status: string;
  severity: string;
  photo_urls: string[];
  notes: string | null;
  display_order: number;
}

export const INSPECTION_CATEGORIES = [
  { key: 'electrical', label: 'Electrical', iconName: 'Zap' },
  { key: 'plumbing', label: 'Plumbing', iconName: 'Droplets' },
  { key: 'civil', label: 'Civil Work', iconName: 'Hammer' },
  { key: 'painting', label: 'Painting', iconName: 'PaintBucket' },
  { key: 'doors_windows', label: 'Doors & Windows', iconName: 'DoorOpen' },
  { key: 'kitchen', label: 'Kitchen', iconName: 'ChefHat' },
  { key: 'bathroom', label: 'Bathroom', iconName: 'Bath' },
  { key: 'flooring', label: 'Flooring', iconName: 'Hammer' },
] as const;

const DEFAULT_ITEMS: Record<string, string[]> = {
  electrical: ['All switches working', 'All socket points functional', 'MCB panel installed properly', 'Earthing connection verified', 'Light fixtures working', 'Fan points functional', 'AC points functional', 'Geyser point working', 'Doorbell working', 'Intercom functional'],
  plumbing: ['No water leakage in taps', 'Hot/cold water supply working', 'Toilet flush working', 'Wash basin drainage clear', 'No seepage on walls', 'Water pressure adequate', 'Overhead tank supply OK', 'Balcony drain functional', 'Kitchen sink drainage'],
  civil: ['No cracks on walls', 'No cracks on ceiling', 'Proper wall plastering', 'No dampness/seepage', 'Skirting properly done', 'Balcony railing secure', 'Proper slope for water drainage', 'Window sills intact'],
  painting: ['Even paint finish on walls', 'No paint drips/marks', 'Ceiling paint uniform', 'Paint color as per specification', 'No patches or unfinished areas', 'Primer visible under paint'],
  doors_windows: ['Main door lock working', 'All room doors close properly', 'Door handles firm', 'Window latches working', 'No gaps in window frames', 'Mosquito mesh installed', 'Sliding doors smooth', 'Balcony door lock working', 'Peephole working'],
  kitchen: ['Kitchen platform installed', 'Sink properly fitted', 'Chimney point available', 'Gas pipeline connection', 'Electrical points above platform', 'Cabinet fittings secure', 'Tiles properly grouted', 'Water supply in kitchen'],
  bathroom: ['Tiles properly laid', 'No leakage from shower', 'Proper slope for drainage', 'Mirror fitted properly', 'Towel rod installed', 'Soap dish installed', 'Exhaust fan working', 'Hot water supply working', 'Commode flush working'],
  flooring: ['No hollow tiles (tap test)', 'Uniform tile joints', 'No cracked tiles', 'Proper grouting', 'Level flooring', 'Threshold strips installed'],
};

export function useInspectionChecklist() {
  const { user, profile, effectiveSocietyId } = useAuth();
  const [checklists, setChecklists] = useState<InspectionChecklist[]>([]);
  const [activeChecklist, setActiveChecklist] = useState<InspectionChecklist | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('electrical');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (effectiveSocietyId && user) fetchChecklists();
  }, [effectiveSocietyId, user]);

  const fetchChecklists = async () => {
    setIsLoading(true);
    const { data } = await supabase.from('inspection_checklists').select('*').eq('resident_id', user!.id).order('created_at', { ascending: false });
    setChecklists((data as InspectionChecklist[]) || []);
    if (data && data.length > 0) { setActiveChecklist(data[0] as InspectionChecklist); fetchItems(data[0].id); }
    else setIsLoading(false);
  };

  const fetchItems = async (checklistId: string) => {
    const { data } = await supabase.from('inspection_items').select('*').eq('checklist_id', checklistId).order('display_order');
    setItems((data as InspectionItem[]) || []);
    setIsLoading(false);
  };

  const createChecklist = async () => {
    if (!user || !effectiveSocietyId) return;
    setIsCreating(true);
    const { data: checklist, error } = await supabase.from('inspection_checklists').insert({
      society_id: effectiveSocietyId, resident_id: user.id, flat_number: profile?.flat_number || 'Unknown',
      inspection_date: new Date().toISOString().split('T')[0], status: 'draft',
      total_items: Object.values(DEFAULT_ITEMS).flat().length,
    }).select().single();

    if (error || !checklist) { toast.error('Failed to create checklist'); setIsCreating(false); return; }

    const allItems = Object.entries(DEFAULT_ITEMS).flatMap(([category, itemNames]) =>
      itemNames.map((name, idx) => ({ checklist_id: checklist.id, category, item_name: name, status: 'not_checked', severity: 'minor', display_order: idx }))
    );
    const { error: itemsError } = await supabase.from('inspection_items').insert(allItems);
    if (itemsError) toast.error('Failed to create checklist items');
    else { toast.success('Inspection checklist created!'); fetchChecklists(); }
    setIsCreating(false);
  };

  const updateItemStatus = async (itemId: string, newStatus: string) => {
    if (!activeChecklist) return;
    const { error } = await supabase.from('inspection_items').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', itemId).eq('checklist_id', activeChecklist.id);
    if (!error) {
      setItems(prev => prev.map(item => item.id === itemId ? { ...item, status: newStatus } : item));
      const updated = items.map(item => item.id === itemId ? { ...item, status: newStatus } : item);
      const passed = updated.filter(i => i.status === 'pass').length;
      const failed = updated.filter(i => i.status === 'fail').length;
      await supabase.from('inspection_checklists').update({ passed_items: passed, failed_items: failed, overall_score: Math.round((passed / updated.length) * 100), status: 'in_progress' }).eq('id', activeChecklist.id).eq('resident_id', user!.id);
    }
  };

  const updateItemNotes = async (itemId: string, notes: string) => {
    if (!activeChecklist) return;
    await supabase.from('inspection_items').update({ notes }).eq('id', itemId).eq('checklist_id', activeChecklist.id);
    setItems(prev => prev.map(item => item.id === itemId ? { ...item, notes } : item));
  };

  const updateItemPhotos = async (itemId: string, url: string) => {
    if (!activeChecklist || !url) return;
    const item = items.find(i => i.id === itemId);
    const newPhotos = [...(item?.photo_urls || []), url];
    await supabase.from('inspection_items').update({ photo_urls: newPhotos } as any).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, photo_urls: newPhotos } : i));
  };

  const submitChecklist = async () => {
    if (!activeChecklist || !user) return;
    const { error } = await supabase.from('inspection_checklists').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', activeChecklist.id).eq('resident_id', user.id);
    if (!error) { toast.success('Checklist submitted to builder!'); fetchChecklists(); }
  };

  const convertToSnags = async () => {
    if (!user || !effectiveSocietyId || !activeChecklist) return;
    const failedItems = items.filter(i => i.status === 'fail');
    const snags = failedItems.map(item => ({
      society_id: effectiveSocietyId, flat_number: activeChecklist.flat_number, reported_by: user.id,
      category: item.category, description: `${item.item_name}${item.notes ? ': ' + item.notes : ''}`,
      photo_urls: item.photo_urls || [], status: 'open',
      sla_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    const { error } = await supabase.from('snag_tickets').insert(snags);
    if (error) { toast.error('Failed to create snag tickets'); console.error(error); }
    else toast.success(`${failedItems.length} snag tickets created!`);
  };

  const categoryItems = items.filter(i => i.category === activeCategory);
  const totalChecked = items.filter(i => i.status !== 'not_checked').length;
  const passedCount = items.filter(i => i.status === 'pass').length;
  const failedCount = items.filter(i => i.status === 'fail').length;
  const progressPercent = items.length > 0 ? Math.round((totalChecked / items.length) * 100) : 0;

  return {
    user, activeChecklist, items, isLoading, activeCategory, setActiveCategory, isCreating,
    categoryItems, totalChecked, passedCount, failedCount, progressPercent,
    createChecklist, updateItemStatus, updateItemNotes, updateItemPhotos, submitChecklist, convertToSnags,
  };
}
