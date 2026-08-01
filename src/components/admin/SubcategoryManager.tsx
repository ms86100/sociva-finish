// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Plus, Edit2, Trash2, Tag, RefreshCw, Sparkles, ImageIcon } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { friendlyError, cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { notify } from '@/lib/notify';

interface Subcategory {
  id: string;
  category_config_id: string;
  slug: string;
  display_name: string;
  display_order: number | null;
  icon: string | null;
  is_active: boolean;
  created_at: string;
  image_url: string | null;
  color: string | null;
  name_placeholder: string | null;
  description_placeholder: string | null;
  price_label: string | null;
  duration_label: string | null;
  show_veg_toggle: boolean | null;
  show_duration_field: boolean | null;
  supports_addons: boolean | null;
  supports_recurring: boolean | null;
  supports_staff_assignment: boolean | null;
}

interface OpenSubcategoryCreateEventDetail {
  categoryConfigId?: string;
}

const COLOR_PRESETS = [
  { label: 'Orange', value: 'bg-orange-100 text-orange-600' }, { label: 'Blue', value: 'bg-blue-100 text-blue-600' },
  { label: 'Green', value: 'bg-green-100 text-green-600' }, { label: 'Purple', value: 'bg-purple-100 text-purple-600' },
  { label: 'Pink', value: 'bg-pink-100 text-pink-600' }, { label: 'Teal', value: 'bg-teal-100 text-teal-600' },
  { label: 'Amber', value: 'bg-amber-100 text-amber-600' }, { label: 'Indigo', value: 'bg-indigo-100 text-indigo-600' },
  { label: 'Emerald', value: 'bg-emerald-100 text-emerald-600' }, { label: 'Violet', value: 'bg-violet-100 text-violet-600' },
  { label: 'Lime', value: 'bg-lime-100 text-lime-600' }, { label: 'Slate', value: 'bg-slate-100 text-slate-600' },
];

const EMOJI_PRESETS = ['🍲', '🍕', '🍰', '🥗', '🧁', '☕', '🥤', '🧃', '🎓', '📚', '🧘', '💃', '🎵', '🎨', '🗣️', '💪', '🔧', '🔌', '🪠', '🪚', '❄️', '🐛', '🔩', '🧹', '👩‍🍳', '🚗', '👶', '✂️', '👗', '💅', '🧕', '💈', '📊', '💻', '📝', '📄', '🎯', '💼', '🏠', '🅿️', '🚲', '🎉', '🎈', '📸', '🎧', '🐕', '🐾', '🐈', '🛋️', '📱', '📖', '🧸', '🍳', '👕', '🎂', '🏡', '🛒', '🎟️', '⭐', '🌟', '🔥', '💎', '🏪', '🌿'];

interface SubcategoryFormData {
  display_name: string;
  slug: string;
  icon: string;
  display_order: string;
  is_active: boolean;
  image_url: string;
  color: string;
  name_placeholder: string;
  description_placeholder: string;
  price_label: string;
  duration_label: string;
  show_veg_toggle: boolean | null;
  show_duration_field: boolean | null;
  supports_addons: boolean | null;
  supports_recurring: boolean | null;
  supports_staff_assignment: boolean | null;
}

const INITIAL_FORM: SubcategoryFormData = {
  display_name: '', slug: '', icon: '', display_order: '0', is_active: true,
  image_url: '', color: '', name_placeholder: '', description_placeholder: '',
  price_label: '', duration_label: '', show_veg_toggle: null, show_duration_field: null,
  supports_addons: null, supports_recurring: null, supports_staff_assignment: null,
};

function GenerateSubcategoryImageButton({ name, subcategoryId, parentCategoryName, imageUrl, onImageGenerated }: {
  name: string; subcategoryId?: string; parentCategoryName?: string; imageUrl?: string | null; onImageGenerated: (url: string) => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const handleGenerate = async () => {
    if (!name.trim()) { toast.error('Enter a name first'); return; }
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-category-image', {
        body: { categoryName: name, categoryKey: `sub_${subcategoryId || name.toLowerCase().replace(/\s+/g, '_')}`, parentGroup: parentCategoryName || 'general', targetType: 'subcategory' },
      });
      if (!error && data?.image_url) { onImageGenerated(data.image_url); toast.success('Image generated!'); }
      else { toast.error('Generation failed'); }
    } catch { toast.error('Generation failed'); } finally { setIsGenerating(false); }
  };
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-semibold"><ImageIcon size={14} />Subcategory Image</Label>
      {imageUrl ? (
        <div className="relative rounded-xl overflow-hidden border border-border aspect-square w-32">
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
            <Button type="button" size="sm" variant="secondary" onClick={handleGenerate} disabled={isGenerating} className="rounded-xl">
              {isGenerating ? <Loader2 className="animate-spin mr-1" size={14} /> : <Sparkles size={14} className="mr-1" />}Regenerate
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={handleGenerate} disabled={isGenerating || !name.trim()} className="w-full gap-2 rounded-xl h-10">
          {isGenerating ? <><Loader2 className="animate-spin" size={16} />Generating AI Image...</> : <><Sparkles size={16} />Generate AI Image</>}
        </Button>
      )}
      {isGenerating && <p className="text-xs text-muted-foreground">This may take 10-15 seconds...</p>}
    </div>
  );
}

export function SubcategoryManager() {
  const [allConfigs, setAllConfigs] = useState<Array<{ id: string; display_name: string; icon: string }>>([]);
  const [configsLoading, setConfigsLoading] = useState(true);

  const fetchConfigs = useCallback(async () => {
    setConfigsLoading(true);
    const { data } = await supabase
      .from('category_config')
      .select('id, display_name, icon')
      .order('display_order', { ascending: true });
    setAllConfigs(data || []);
    setConfigsLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subcategory | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<SubcategoryFormData>(INITIAL_FORM);
  const [createConfigId, setCreateConfigId] = useState<string>('');

  const fetchSubcategories = useCallback(async () => {
    setIsLoading(true);
    let q = supabase.from('subcategories').select('*').order('display_order', { ascending: true });
    if (selectedConfigId) {
      q = q.eq('category_config_id', selectedConfigId);
    }
    const { data } = await q;
    setSubcategories((data || []) as Subcategory[]);
    setIsLoading(false);
  }, [selectedConfigId]);

  useEffect(() => { fetchSubcategories(); }, [fetchSubcategories]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpenCreate = (event: Event) => {
      const detail = (event as CustomEvent<OpenSubcategoryCreateEventDetail>).detail;
      const preferredConfigId = detail?.categoryConfigId || selectedConfigId || '';
      setFormData(INITIAL_FORM);
      setEditingSub(null);
      setCreateConfigId(preferredConfigId);
      if (preferredConfigId) setSelectedConfigId(preferredConfigId);
      fetchConfigs();
      setIsDialogOpen(true);
    };
    window.addEventListener('admin:open-subcategory-create', handleOpenCreate);
    return () => window.removeEventListener('admin:open-subcategory-create', handleOpenCreate);
  }, [selectedConfigId]);

  const getCategoryName = (configId: string) => {
    const c = allConfigs.find(cfg => cfg.id === configId);
    return c ? c.display_name : configId;
  };

  const getParentCategoryName = (configId: string) => {
    const c = allConfigs.find(cfg => cfg.id === configId);
    return c?.display_name || '';
  };

  const resetForm = () => {
    setFormData(INITIAL_FORM);
    setEditingSub(null);
    setCreateConfigId('');
  };

  const openCreate = (preferredConfigId?: string) => {
    resetForm();
    const nextConfigId = preferredConfigId ?? selectedConfigId ?? '';
    setCreateConfigId(nextConfigId);
    if (nextConfigId) setSelectedConfigId(nextConfigId);
    fetchConfigs();
    setIsDialogOpen(true);
  };

  const openEdit = (sub: Subcategory) => {
    setEditingSub(sub);
    setFormData({
      display_name: sub.display_name,
      slug: sub.slug,
      icon: sub.icon || '',
      display_order: (sub.display_order ?? 0).toString(),
      is_active: sub.is_active,
      image_url: sub.image_url || '',
      color: sub.color || '',
      name_placeholder: sub.name_placeholder || '',
      description_placeholder: sub.description_placeholder || '',
      price_label: sub.price_label || '',
      duration_label: sub.duration_label || '',
      show_veg_toggle: sub.show_veg_toggle,
      show_duration_field: sub.show_duration_field,
      supports_addons: (sub as any).supports_addons ?? null,
      supports_recurring: (sub as any).supports_recurring ?? null,
      supports_staff_assignment: (sub as any).supports_staff_assignment ?? null,
    });
    setCreateConfigId(sub.category_config_id);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.display_name.trim() || !formData.slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    const configId = editingSub ? editingSub.category_config_id : createConfigId;
    if (!configId) {
      notify.block('Please select a parent category');
      return;
    }
    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        category_config_id: configId,
        display_name: formData.display_name.trim(),
        slug: formData.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
        icon: formData.icon.trim() || null,
        display_order: parseInt(formData.display_order) || 0,
        is_active: formData.is_active,
        image_url: formData.image_url.trim() || null,
        color: formData.color || null,
        name_placeholder: formData.name_placeholder.trim() || null,
        description_placeholder: formData.description_placeholder.trim() || null,
        price_label: formData.price_label.trim() || null,
        duration_label: formData.duration_label.trim() || null,
        show_veg_toggle: formData.show_veg_toggle,
        show_duration_field: formData.show_duration_field,
        supports_addons: formData.supports_addons,
        supports_recurring: formData.supports_recurring,
        supports_staff_assignment: formData.supports_staff_assignment,
      };
      if (editingSub) {
        const { error } = await supabase.from('subcategories').update(payload).eq('id', editingSub.id);
        if (error) throw error;
        toast.success('Subcategory updated');
      } else {
        const { error } = await supabase.from('subcategories').insert(payload as any);
        if (error) throw error;
        toast.success('Subcategory created');
      }
      setIsDialogOpen(false);
      resetForm();
      fetchSubcategories();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('subcategories').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success('Subcategory deleted');
      fetchSubcategories();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleFilterChange = (value: string) => {
    setSelectedConfigId(value === 'all' ? '' : value);
  };

  const activeConfigId = editingSub ? editingSub.category_config_id : createConfigId;

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Tag size={16} className="text-violet-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Subcategory Management</h3>
            <p className="text-[10px] text-muted-foreground">Manage subcategories within each category</p>
          </div>
        </div>

        {/* Filter by category */}
        <div className="flex items-center gap-2">
          <Select value={selectedConfigId || 'all'} onValueChange={handleFilterChange}>
            <SelectTrigger className="flex-1 rounded-xl">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {allConfigs.map(c => (
                <SelectItem key={c.id} value={c.id}><span className="inline-flex items-center gap-1.5"><DynamicIcon name={c.icon} size={14} /> {c.display_name}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-xl" onClick={() => fetchConfigs()} disabled={configsLoading} title="Refresh categories">
            <RefreshCw size={14} className={configsLoading ? 'animate-spin' : ''} />
          </Button>
          <Button size="sm" onClick={() => openCreate()} className="rounded-xl font-semibold gap-1.5">
            <Plus size={13} /> Add Subcategory
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : subcategories.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Tag size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">No subcategories yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Add one to help buyers filter within categories.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {subcategories.map((sub, idx) => (
              <motion.div key={sub.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}>
                <div className="flex items-center gap-3 p-3 bg-card border border-border/30 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 group">
                  {sub.image_url ? (
                    <img src={sub.image_url} alt={sub.display_name} className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <DynamicIcon name={sub.icon || 'FolderOpen'} size={18} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{sub.display_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {getCategoryName(sub.category_config_id)} · <span className="font-mono">{sub.slug}</span>
                    </p>
                  </div>
                  {sub.color && (
                    <div className={cn('w-4 h-4 rounded', sub.color)} />
                  )}
                  {!sub.is_active && (
                    <Badge variant="secondary" className="text-[10px] rounded-md">Inactive</Badge>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-xl" onClick={() => openEdit(sub)}>
                    <Edit2 size={13} />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-xl text-destructive" onClick={() => setDeleteTarget(sub)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog — Rich form matching Category edit dialog */}
        <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setIsDialogOpen(o); }}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle className="font-bold">{editingSub ? 'Edit Subcategory' : 'Add Subcategory'}</DialogTitle>
              <DialogDescription className="text-xs">
                {editingSub ? 'Update this subcategory settings.' : 'Create a new subcategory under a parent category.'}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 py-2 pr-3">
                {/* Parent Category */}
                {!editingSub ? (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Parent Category *</Label>
                    <Select value={createConfigId} onValueChange={setCreateConfigId}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {allConfigs.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.icon} {c.display_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-semibold">Parent:</Label>
                    <Badge variant="secondary" className="rounded-lg text-xs">{getCategoryName(editingSub.category_config_id)}</Badge>
                  </div>
                )}

                {/* Display Name */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Display Name *</Label>
                  <Input
                    placeholder="e.g. Dairy Products"
                    value={formData.display_name}
                    onChange={e => {
                      const name = e.target.value;
                      setFormData({
                        ...formData,
                        display_name: name,
                        slug: editingSub ? formData.slug : name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                      });
                    }}
                    className="rounded-xl"
                  />
                </div>

                {/* AI Image Generation */}
                <GenerateSubcategoryImageButton
                  name={formData.display_name}
                  subcategoryId={editingSub?.id}
                  parentCategoryName={getParentCategoryName(activeConfigId)}
                  imageUrl={formData.image_url || null}
                  onImageGenerated={(url) => setFormData({ ...formData, image_url: url })}
                />

                {/* Icon (Emoji or Lucide name) */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Icon (Emoji or Lucide name)</Label>
                  <Input value={formData.icon} onChange={e => setFormData({ ...formData, icon: e.target.value })} className="text-2xl rounded-xl" />
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {EMOJI_PRESETS.slice(0, 24).map((emoji) => (
                      <button key={emoji} type="button" onClick={() => setFormData({ ...formData, icon: emoji })} className={cn('w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-muted transition-colors', formData.icon === emoji && 'bg-primary/15 ring-1 ring-primary')}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Color</Label>
                  <Select value={formData.color || 'none'} onValueChange={(value) => setFormData({ ...formData, color: value === 'none' ? '' : value })}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Inherit from parent" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <span className="text-muted-foreground">Inherit from parent</span>
                      </SelectItem>
                      {COLOR_PRESETS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2"><div className={cn('w-4 h-4 rounded', color.value)} />{color.label}</div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Slug + Order */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Slug</Label>
                    <Input value={formData.slug} onChange={e => setFormData({ ...formData, slug: e.target.value })} className="rounded-xl font-mono text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Display Order</Label>
                    <Input type="number" value={formData.display_order} onChange={e => setFormData({ ...formData, display_order: e.target.value })} className="rounded-xl" />
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                  <span className="text-xs font-medium">Active</span>
                  <Switch checked={formData.is_active} onCheckedChange={c => setFormData({ ...formData, is_active: c })} />
                </div>

                {/* ── Form tweaks (fields the seller product form actually reads) ── */}
                <div className="border-t pt-4 mt-2">
                  <Label className="text-xs text-muted-foreground mb-3 block font-bold uppercase tracking-wider">Form tweaks</Label>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    Only veg/duration and service flags override the parent category on the seller form. Leave as Inherit to use the parent.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <span className="text-xs font-medium">Show Veg/Non-Veg Toggle</span>
                      <Select
                        value={formData.show_veg_toggle === null ? 'inherit' : formData.show_veg_toggle ? 'yes' : 'no'}
                        onValueChange={(v) => setFormData({ ...formData, show_veg_toggle: v === 'inherit' ? null : v === 'yes' })}
                      >
                        <SelectTrigger className="w-28 h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Inherit</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <span className="text-xs font-medium">Show Duration Field</span>
                      <Select
                        value={formData.show_duration_field === null ? 'inherit' : formData.show_duration_field ? 'yes' : 'no'}
                        onValueChange={(v) => setFormData({ ...formData, show_duration_field: v === 'inherit' ? null : v === 'yes' })}
                      >
                        <SelectTrigger className="w-28 h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Inherit</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* ── Service Feature Toggles ── */}
                <div className="border-t pt-4 mt-2">
                  <Label className="text-xs text-muted-foreground mb-3 block font-bold uppercase tracking-wider">Service Features</Label>
                  <p className="text-[10px] text-muted-foreground mb-3">Toggle service features for this subcategory. When off, the parent category's setting is used.</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <div>
                        <span className="text-xs font-medium">Service Add-ons</span>
                        <p className="text-[10px] text-muted-foreground">Allow sellers to offer optional extras</p>
                      </div>
                      <Switch checked={formData.supports_addons ?? false} onCheckedChange={(v) => setFormData({ ...formData, supports_addons: v })} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <div>
                        <span className="text-xs font-medium">Recurring Booking</span>
                        <p className="text-[10px] text-muted-foreground">Enable buyers to set up recurring bookings</p>
                      </div>
                      <Switch checked={formData.supports_recurring ?? false} onCheckedChange={(v) => setFormData({ ...formData, supports_recurring: v })} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <div>
                        <span className="text-xs font-medium">Staff Assignment</span>
                        <p className="text-[10px] text-muted-foreground">Allow sellers to assign staff to bookings</p>
                      </div>
                      <Switch checked={formData.supports_staff_assignment ?? false} onCheckedChange={(v) => setFormData({ ...formData, supports_staff_assignment: v })} />
                    </div>
                  </div>
                </div>

                {/* Save */}
                <Button onClick={handleSave} disabled={isSaving} className="w-full rounded-xl h-11 font-semibold">
                  {isSaving && <Loader2 className="animate-spin mr-2" size={16} />}
                  {editingSub ? 'Save Changes' : 'Create Subcategory'}
                </Button>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-bold">Delete "{deleteTarget?.display_name}"?</AlertDialogTitle>
              <AlertDialogDescription>Products using this subcategory will lose their subcategory assignment.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground rounded-xl">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
