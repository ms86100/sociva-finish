// @ts-nocheck
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { toast } from 'sonner';

interface CategoryLicenseConfig {
  id: string;
  category: string;
  display_name: string;
  icon: string;
  parent_group: string;
  requires_license: boolean;
  license_type_name: string | null;
  license_description: string | null;
  license_mandatory: boolean;
}

interface ParentGroupInfo {
  slug: string;
  name: string;
  icon: string;
}

export function LicenseConfigSection() {
  const [categories, setCategories] = useState<CategoryLicenseConfig[]>([]);
  const [parentGroups, setParentGroups] = useState<ParentGroupInfo[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingCategory, setEditingCategory] = useState<CategoryLicenseConfig | null>(null);
  const [editForm, setEditForm] = useState({ license_type_name: '', license_description: '' });

  const fetchData = async () => {
    const [catRes, pgRes] = await Promise.all([
      supabase.from('category_config').select('id, category, display_name, icon, parent_group, requires_license, license_type_name, license_description, license_mandatory').order('display_order'),
      supabase.from('parent_groups').select('slug, name, icon').order('sort_order'),
    ]);
    setCategories((catRes.data as any[]) || []);
    setParentGroups((pgRes.data as any[]) || []);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleExpand = (slug: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  const toggleRequiresLicense = async (cat: CategoryLicenseConfig, checked: boolean) => {
    await supabase.from('category_config').update({ requires_license: checked } as any).eq('id', cat.id);
    toast.success(checked ? `License enabled for ${cat.display_name}` : `License disabled for ${cat.display_name}`);
    fetchData();
  };

  const toggleMandatory = async (cat: CategoryLicenseConfig, checked: boolean) => {
    await supabase.from('category_config').update({ license_mandatory: checked } as any).eq('id', cat.id);
    toast.success(checked ? 'License now mandatory' : 'License now optional');
    fetchData();
  };

  const saveConfig = async () => {
    if (!editingCategory) return;
    await supabase.from('category_config').update({
      license_type_name: editForm.license_type_name.trim() || null,
      license_description: editForm.license_description.trim() || null,
    } as any).eq('id', editingCategory.id);
    toast.success('License config updated');
    setEditingCategory(null);
    fetchData();
  };

  const grouped = parentGroups.map(pg => ({
    ...pg,
    categories: categories.filter(c => c.parent_group === pg.slug),
  })).filter(g => g.categories.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Shield size={15} className="text-violet-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">License Requirements</h3>
          <p className="text-[10px] text-muted-foreground">Configure which categories require sellers to upload a license.</p>
        </div>
      </div>

      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardContent className="p-4 space-y-1">
          {grouped.map((group) => (
            <div key={group.slug}>
              {/* Parent Group Header */}
              <button
                onClick={() => toggleExpand(group.slug)}
                className="flex items-center gap-2.5 w-full p-3 rounded-xl hover:bg-muted/50 transition-colors"
              >
                {expandedGroups.has(group.slug) ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                <DynamicIcon name={group.icon} size={14} />
                <span className="font-semibold text-xs flex-1 text-left">{group.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {group.categories.filter(c => c.requires_license).length}/{group.categories.length} enabled
                </span>
              </button>

              {/* Category Rows */}
              {expandedGroups.has(group.slug) && (
                <div className="ml-6 space-y-1 mb-2">
                  {group.categories.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-2.5 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <DynamicIcon name={cat.icon} size={12} />
                        <div className="min-w-0">
                          <p className="font-medium text-[11px]">{cat.display_name}</p>
                          {cat.requires_license && cat.license_type_name && (
                            <p className="text-[10px] text-muted-foreground truncate">{cat.license_type_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {cat.requires_license && (
                          <>
                            <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 rounded-md"
                              onClick={() => { setEditingCategory(cat); setEditForm({ license_type_name: cat.license_type_name || '', license_description: cat.license_description || '' }); }}>
                              Edit
                            </Button>
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] text-muted-foreground">Mandatory</span>
                              <Switch checked={cat.license_mandatory} onCheckedChange={(c) => toggleMandatory(cat, c)} />
                            </div>
                          </>
                        )}
                        <Switch checked={cat.requires_license} onCheckedChange={(c) => toggleRequiresLicense(cat, c)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Edit Category License Config Dialog */}
      <Dialog open={!!editingCategory} onOpenChange={() => setEditingCategory(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-bold">Configure License for {editingCategory?.display_name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">License Type Name</label>
              <Input placeholder="e.g., FSSAI Certificate" value={editForm.license_type_name} onChange={(e) => setEditForm({ ...editForm, license_type_name: e.target.value })} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Description for Sellers</label>
              <Textarea placeholder="Instructions for sellers..." value={editForm.license_description} onChange={(e) => setEditForm({ ...editForm, license_description: e.target.value })} rows={3} className="rounded-xl" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl h-10" onClick={() => setEditingCategory(null)}>Cancel</Button>
              <Button className="flex-1 rounded-xl h-10 font-semibold" onClick={saveConfig}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
