// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmAction } from '@/components/ui/confirm-action';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { Plus, Pencil, Trash2, GripVertical, ChevronDown, ChevronUp, X } from 'lucide-react';
import { adminNotify } from '@/lib/admin-notify';
import { notify } from '@/lib/notify';
import { friendlyError } from '@/lib/utils';

interface SchemaField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'tag_input' | 'boolean' | 'textarea' | 'date';
  options?: string[];
  placeholder?: string;
}

interface AttributeBlock {
  id: string;
  block_type: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  category_hints: string[] | null;
  schema: { fields: SchemaField[] };
  renderer_type: string;
  display_order: number;
  is_active: boolean;
  buyer_selectable?: boolean;
  created_at: string;
}

const FIELD_TYPES: { value: SchemaField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'tag_input', label: 'Tags' },
  { value: 'boolean', label: 'Toggle' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'date', label: 'Date' },
];

const RENDERER_TYPES = [
  { value: 'key_value', label: 'Key-Value Grid' },
  { value: 'tags', label: 'Tags / Chips' },
  { value: 'table', label: 'Table' },
  { value: 'badge_list', label: 'Badge List' },
  { value: 'text', label: 'Plain Text' },
];

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function emptyField(): SchemaField {
  return { key: '', label: '', type: 'text', placeholder: '' };
}

export function AdminAttributeBlockManager() {
  const [blocks, setBlocks] = useState<AttributeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AttributeBlock | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [rendererType, setRendererType] = useState('key_value');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [fields, setFields] = useState<SchemaField[]>([emptyField()]);
  const [buyerSelectable, setBuyerSelectable] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: categories = [] } = useCategoryConfig();

  useEffect(() => { fetchBlocks(); }, []);

  const fetchBlocks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('attribute_block_library')
      .select('*')
      .order('display_order');
    if (error) { adminNotify.error('Failed to load blocks'); console.error(error); }
    else setBlocks((data || []) as unknown as AttributeBlock[]);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingBlock(null);
    setDisplayName('');
    setDescription('');
    setIcon('');
    setRendererType('key_value');
    setSelectedCategories([]);
    setFields([emptyField()]);
    setBuyerSelectable(false);
    setSheetOpen(true);
  };

  const openEdit = (block: AttributeBlock) => {
    setEditingBlock(block);
    setDisplayName(block.display_name);
    setDescription(block.description || '');
    setIcon(block.icon || '');
    setRendererType(block.renderer_type);
    setSelectedCategories(block.category_hints || []);
    const schemaFields = block.schema?.fields?.length ? block.schema.fields : (block as any).default_config?.fields;
    setFields(Array.isArray(schemaFields) && schemaFields.length > 0 ? schemaFields : [emptyField()]);
    setBuyerSelectable(block.buyer_selectable === true);
    setSheetOpen(true);
  };

  const toggleActive = async (block: AttributeBlock) => {
    const { error } = await supabase
      .from('attribute_block_library')
      .update({ is_active: !block.is_active })
      .eq('id', block.id);
    if (error) adminNotify.error('Failed to update');
    else {
      adminNotify.success(block.is_active ? 'Block deactivated' : 'Block activated');
      fetchBlocks();
    }
  };

  const deleteBlock = async (block: AttributeBlock) => {
    const { error } = await supabase
      .from('attribute_block_library')
      .update({ is_active: false })
      .eq('id', block.id);
    if (error) adminNotify.error('Failed to deactivate');
    else { adminNotify.success('Block deactivated'); fetchBlocks(); }
  };

  const handleSave = async () => {
    if (!displayName.trim()) { adminNotify.error('Display name is required'); return; }
    if (fields.some(f => !f.label.trim())) { adminNotify.error('All fields must have a label'); return; }
    if (selectedCategories.length === 0) { notify.block('Select at least one category'); return; }

    setSaving(true);
    const cleanFields = fields.map(f => ({
      ...f,
      key: f.key || slugify(f.label),
      options: f.type === 'select' ? (f.options || []).filter(Boolean) : undefined,
      placeholder: f.placeholder || undefined,
    }));

    const blockType = editingBlock?.block_type || slugify(displayName);

    const payload = {
      block_type: blockType,
      display_name: displayName.trim(),
      description: description.trim() || null,
      icon: icon.trim() || null,
      renderer_type: rendererType,
      category_hints: selectedCategories,
      schema: { fields: cleanFields } as any,
      default_config: { fields: cleanFields } as any,
      buyer_selectable: buyerSelectable,
    };

    let error;
    if (editingBlock) {
      ({ error } = await supabase
        .from('attribute_block_library')
        .update(payload)
        .eq('id', editingBlock.id));
    } else {
      ({ error } = await supabase
        .from('attribute_block_library')
        .insert({ ...payload, display_order: blocks.length + 1 }));
    }

    setSaving(false);
    if (error) { adminNotify.error(friendlyError(error) || 'Failed to save attribute block'); return; }
    adminNotify.success(editingBlock ? 'Block updated' : 'Block created');
    setSheetOpen(false);
    fetchBlocks();
  };

  // Field management
  const updateField = (idx: number, patch: Partial<SchemaField>) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch, key: patch.label ? slugify(patch.label) : f.key } : f));
  };
  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx));
  const addField = () => setFields(prev => [...prev, emptyField()]);
  const moveField = (idx: number, dir: -1 | 1) => {
    setFields(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // Option management for select fields
  const addOption = (fieldIdx: number) => {
    setFields(prev => prev.map((f, i) => i === fieldIdx ? { ...f, options: [...(f.options || []), ''] } : f));
  };
  const updateOption = (fieldIdx: number, optIdx: number, value: string) => {
    setFields(prev => prev.map((f, i) => {
      if (i !== fieldIdx) return f;
      const opts = [...(f.options || [])];
      opts[optIdx] = value;
      return { ...f, options: opts };
    }));
  };
  const removeOption = (fieldIdx: number, optIdx: number) => {
    setFields(prev => prev.map((f, i) => {
      if (i !== fieldIdx) return f;
      return { ...f, options: (f.options || []).filter((_, j) => j !== optIdx) };
    }));
  };

  const toggleCategory = (slug: string) => {
    setSelectedCategories(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    );
  };

  const filteredBlocks = filterCategory === 'all'
    ? blocks
    : blocks.filter(b => (b.category_hints || []).includes(filterCategory));

  const categoryMap = Object.fromEntries(categories.map((c: any) => [c.category, c.display_name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Attribute Blocks ({filteredBlocks.length})
        </h3>
        <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" /> New Block</Button>
      </div>

      {/* Filter */}
      <Select value={filterCategory} onValueChange={setFilterCategory}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Filter by category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((c: any) => (
            <SelectItem key={c.category} value={c.category}>{c.display_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Block List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filteredBlocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attribute blocks found.</p>
      ) : (
        <div className="space-y-2">
          {filteredBlocks.map(block => (
            <Card key={block.id} className={!block.is_active ? 'opacity-50' : ''}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {block.icon && <span className="text-sm">{block.icon}</span>}
                      <p className="font-medium text-sm truncate">{block.display_name}</p>
                      <Badge variant="outline" className="text-[9px] shrink-0">{block.renderer_type}</Badge>
                      {block.buyer_selectable && <Badge variant="secondary" className="text-[9px]">Buyers pick</Badge>}
                      {!block.is_active && <Badge variant="secondary" className="text-[9px]">Inactive</Badge>}
                    </div>
                    {block.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{block.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(block.category_hints || []).slice(0, 4).map(cat => (
                        <Badge key={cat} variant="secondary" className="text-[9px]">
                          {categoryMap[cat] || cat}
                        </Badge>
                      ))}
                      {(block.category_hints || []).length > 4 && (
                        <Badge variant="secondary" className="text-[9px]">
                          +{(block.category_hints || []).length - 4}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {(block.schema?.fields || []).length} field(s) · {block.block_type}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={block.is_active}
                      onCheckedChange={() => toggleActive(block)}
                      className="scale-75"
                    />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(block)}>
                      <Pencil size={12} />
                    </Button>
                    <ConfirmAction
                      title="Deactivate Block?"
                      description="This will hide the block from all sellers. Existing product data will not be deleted."
                      actionLabel="Deactivate"
                      onConfirm={() => deleteBlock(block)}
                    >
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive">
                        <Trash2 size={12} />
                      </Button>
                    </ConfirmAction>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <DrawerTitle>{editingBlock ? 'Edit Block' : 'Create Attribute Block'}</DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="h-[calc(90vh-80px)] pr-2 mt-4">
            <div className="space-y-4 pb-8">
              {/* Basic Info */}
              <div className="space-y-2">
                <Label className="text-xs">Display Name *</Label>
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Food Details" className="h-9 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" className="text-sm min-h-[60px]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Icon (emoji)</Label>
                  <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🍕" className="h-9 text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Renderer Type</Label>
                  <Select value={rendererType} onValueChange={setRendererType}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RENDERER_TYPES.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-xs font-medium">Buyers can pick these options</p>
                  <p className="text-[10px] text-muted-foreground">Show as chips on enquiry, booking and add to cart</p>
                </div>
                <Switch checked={buyerSelectable} onCheckedChange={setBuyerSelectable} />
              </div>

              {/* Category Assignment */}
              <div className="space-y-2">
              <Label className="text-xs">Attach to Categories * ({selectedCategories.length} selected)</Label>
                <Card>
                  <CardContent className="p-2 max-h-48 overflow-y-auto">
                    {categories.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">Loading categories…</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-1">
                        {categories.map((c: any) => (
                          <label key={c.category} className="flex items-center gap-2 text-xs cursor-pointer py-1.5 px-1 rounded hover:bg-muted/50 transition-colors">
                            <Checkbox
                              checked={selectedCategories.includes(c.category)}
                              onCheckedChange={() => toggleCategory(c.category)}
                            />
                            <span className="flex items-center gap-1.5">
                              {c.icon && <span>{c.icon}</span>}
                              <span className="font-medium">{c.display_name || c.category}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Schema Builder */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Fields ({fields.length})</Label>
                {fields.map((field, idx) => (
                  <Card key={idx} className="border-dashed">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground font-mono">Field {idx + 1}</span>
                        <div className="flex items-center gap-0.5">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveField(idx, -1)} disabled={idx === 0}>
                            <ChevronUp size={12} />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveField(idx, 1)} disabled={idx === fields.length - 1}>
                            <ChevronDown size={12} />
                          </Button>
                          {fields.length > 1 && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeField(idx)}>
                              <X size={12} />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Label *</Label>
                          <Input
                            value={field.label}
                            onChange={e => updateField(idx, { label: e.target.value })}
                            placeholder="e.g. Cuisine Type"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Input Type</Label>
                          <Select value={field.type} onValueChange={(v) => updateField(idx, { type: v as SchemaField['type'] })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map(ft => (
                                <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px]">Placeholder</Label>
                        <Input
                          value={field.placeholder || ''}
                          onChange={e => updateField(idx, { placeholder: e.target.value })}
                          placeholder="Optional hint text"
                          className="h-8 text-xs"
                        />
                      </div>
                      {/* Key preview */}
                      <p className="text-[9px] text-muted-foreground font-mono">key: {field.key || slugify(field.label) || '—'}</p>

                      {/* Options for select type */}
                      {field.type === 'select' && (
                        <div className="space-y-1 pl-2 border-l-2 border-muted">
                          <Label className="text-[10px]">Dropdown Options</Label>
                          {(field.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="flex items-center gap-1">
                              <Input
                                value={opt}
                                onChange={e => updateOption(idx, optIdx, e.target.value)}
                                placeholder={`Option ${optIdx + 1}`}
                                className="h-7 text-xs flex-1"
                              />
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => removeOption(idx, optIdx)}>
                                <X size={10} />
                              </Button>
                            </div>
                          ))}
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addOption(idx)}>
                            <Plus size={10} className="mr-1" /> Add Option
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                <Button size="sm" variant="outline" className="w-full" onClick={addField}>
                  <Plus size={14} className="mr-1" /> Add Field
                </Button>
              </div>

              {/* Save */}
              <Button className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingBlock ? 'Update Block' : 'Create Block'}
              </Button>
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
