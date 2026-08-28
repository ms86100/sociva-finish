// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useParentGroups, ParentGroupRow } from '@/hooks/useParentGroups';
import { adminNotify } from '@/lib/admin-notify';
import { friendlyError } from '@/lib/utils';
import {
  useSensor, useSensors, PointerSensor, KeyboardSensor,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { journeyFromTransactionType, journeyPayload, type BuyerJourneyId } from '@/lib/buyer-journey';

export interface CategoryConfigRow {
  id: string;
  category: string;
  display_name: string;
  icon: string;
  color: string;
  parent_group: string;
  display_order: number;
  is_active: boolean;
  image_url?: string | null;
  name_placeholder?: string | null;
  description_placeholder?: string | null;
  price_label?: string | null;
  duration_label?: string | null;
  show_veg_toggle?: boolean | null;
  show_duration_field?: boolean | null;
  transaction_type?: string;
  default_action_type?: string | null;
  supports_addons?: boolean;
  supports_recurring?: boolean;
  supports_staff_assignment?: boolean;
}

export function useCategoryManagerData() {
  const queryClient = useQueryClient();
  const { groups, parentGroupInfos, isLoading: groupsLoading, refresh: refreshGroups } = useParentGroups();
  const [categories, setCategories] = useState<CategoryConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGroupSlug, setSelectedGroupSlug] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryConfigRow | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '', icon: '', color: '', image_url: '' as string | null,
    name_placeholder: '', description_placeholder: '', price_label: '', duration_label: '',
    show_veg_toggle: false, show_duration_field: false,
    transaction_type: 'cart_purchase', buyer_journey: 'cart' as BuyerJourneyId,
    supports_addons: false, supports_recurring: false, supports_staff_assignment: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    display_name: '', icon: '', color: 'bg-blue-100 text-blue-600', parent_group: '',
    image_url: null as string | null, transaction_type: 'cart_purchase',
    buyer_journey: 'cart' as BuyerJourneyId,
  });
  const [deleteCategory, setDeleteCategory] = useState<CategoryConfigRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ParentGroupRow | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', icon: '', color: 'bg-blue-100 text-blue-600', description: '' });
  const [deleteGroup, setDeleteGroup] = useState<ParentGroupRow | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => { fetchCategories(); }, []);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase.from('category_config').select('*').order('display_order');
      if (error) throw error;
      setCategories(data || []);
    } catch { adminNotify.error('Failed to load categories'); }
    finally { setIsLoading(false); }
  };

  const toggleCategory = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase.from('category_config').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
      setCategories(categories.map(c => c.id === id ? { ...c, is_active: isActive } : c));
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      adminNotify.success(isActive ? 'Category enabled' : 'Category disabled');
    } catch { adminNotify.error('Failed to update category'); }
  };

  const openEditDialog = (category: CategoryConfigRow) => {
    setEditingCategory(category);
    const journey = journeyFromTransactionType(category.transaction_type);
    setEditForm({
      display_name: category.display_name, icon: category.icon, color: category.color,
      image_url: category.image_url || null, name_placeholder: category.name_placeholder || '',
      description_placeholder: category.description_placeholder || '', price_label: category.price_label || 'Price',
      duration_label: category.duration_label || '', show_veg_toggle: category.show_veg_toggle ?? false,
      show_duration_field: category.show_duration_field ?? false,
      transaction_type: category.transaction_type || 'cart_purchase',
      buyer_journey: journey,
      supports_addons: category.supports_addons ?? false,
      supports_recurring: category.supports_recurring ?? false,
      supports_staff_assignment: category.supports_staff_assignment ?? false,
    });
  };

  const saveEditedCategory = async () => {
    if (!editingCategory) return;
    if (!editForm.display_name.trim()) { adminNotify.error('Display name is required'); return; }
    setIsSaving(true);
    try {
      const journeyFields = journeyPayload(editForm.buyer_journey);
      const { error } = await supabase.from('category_config').update({
        display_name: editForm.display_name.trim(),
        icon: editForm.icon.trim(),
        color: editForm.color.trim(),
        image_url: editForm.image_url || null,
        name_placeholder: editForm.name_placeholder.trim() || null,
        description_placeholder: editForm.description_placeholder.trim() || null,
        price_label: editForm.price_label.trim() || 'Price',
        duration_label: editForm.duration_label.trim() || null,
        show_veg_toggle: editForm.show_veg_toggle,
        show_duration_field: editForm.show_duration_field,
        supports_addons: editForm.supports_addons,
        supports_recurring: editForm.supports_recurring,
        supports_staff_assignment: editForm.supports_staff_assignment,
        ...journeyFields,
      }).eq('id', editingCategory.id);
      if (error) throw error;
      setCategories(categories.map(c => c.id === editingCategory.id ? { ...c, ...editForm, ...journeyFields } : c));
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      adminNotify.success('Category updated');
      setEditingCategory(null);
    } catch { adminNotify.error('Failed to update category'); }
    finally { setIsSaving(false); }
  };

  const generateCategoryKey = (displayName: string): string => displayName.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');

  const openAddDialog = (groupSlug: string) => {
    setAddingToGroup(groupSlug);
    setAddForm({
      display_name: '', icon: '', color: 'bg-blue-100 text-blue-600', parent_group: groupSlug,
      image_url: null, transaction_type: 'cart_purchase', buyer_journey: 'cart',
    });
    setIsAddDialogOpen(true);
  };

  const saveNewCategory = async () => {
    if (!addForm.display_name.trim()) { adminNotify.error('Display name is required'); return; }
    if (!addForm.icon.trim()) { adminNotify.error('Icon is required'); return; }
    const categoryKey = generateCategoryKey(addForm.display_name);
    if (categories.some(c => c.category === categoryKey)) { adminNotify.error('A category with this key already exists'); return; }
    setIsSaving(true);
    try {
      const groupCats = categories.filter(c => c.parent_group === addForm.parent_group);
      const maxOrder = groupCats.length > 0 ? Math.max(...groupCats.map(c => c.display_order)) : 0;
      const journeyFields = journeyPayload(addForm.buyer_journey);
      const { data, error } = await supabase.from('category_config').insert({
        category: categoryKey as any,
        display_name: addForm.display_name.trim(),
        icon: addForm.icon.trim(),
        color: addForm.color,
        parent_group: addForm.parent_group,
        display_order: maxOrder + 1,
        is_active: true,
        image_url: addForm.image_url || null,
        ...journeyFields,
      } as any).select().single();
      if (error) throw error;
      setCategories([...categories, data]);
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      adminNotify.success('Category added — attach attribute blocks in the Attributes tab if needed');
      setIsAddDialogOpen(false);
    } catch (error: any) { adminNotify.error(friendlyError(error)); }
    finally { setIsSaving(false); }
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategory) return;
    setIsDeleting(true);
    try {
      const { data: sellers } = await supabase.from('seller_profiles').select('id').contains('categories', [deleteCategory.category]).limit(1);
      if (sellers && sellers.length > 0) {
        await supabase.from('category_config').update({ is_active: false }).eq('id', deleteCategory.id);
        setCategories(categories.map(c => c.id === deleteCategory.id ? { ...c, is_active: false } : c));
        queryClient.invalidateQueries({ queryKey: ['category-configs'] });
        adminNotify.info('Category disabled (sellers are using it)');
      } else {
        await supabase.from('category_config').delete().eq('id', deleteCategory.id);
        setCategories(categories.filter(c => c.id !== deleteCategory.id));
        queryClient.invalidateQueries({ queryKey: ['category-configs'] });
        adminNotify.success('Category deleted');
      }
      setDeleteCategory(null);
    } catch { adminNotify.error('Failed to delete category'); }
    finally { setIsDeleting(false); }
  };

  const toggleGroup = async (group: ParentGroupRow, enable: boolean) => {
    try {
      await supabase.from('parent_groups').update({ is_active: enable }).eq('id', group.id);
      if (!enable) {
        const groupCats = categories.filter(c => c.parent_group === group.slug);
        if (groupCats.length > 0) {
          await supabase.from('category_config').update({ is_active: false }).in('id', groupCats.map(c => c.id));
          setCategories(categories.map(c => c.parent_group === group.slug ? { ...c, is_active: false } : c));
        }
      }
      await refreshGroups();
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      adminNotify.success(enable ? `${group.name} section enabled` : `${group.name} section disabled`);
    } catch { adminNotify.error('Failed to update section'); }
  };

  const openGroupDialog = (group?: ParentGroupRow) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({ name: group.name, icon: group.icon, color: group.color, description: group.description });
    } else {
      setEditingGroup(null);
      setGroupForm({ name: '', icon: '', color: 'bg-blue-100 text-blue-600', description: '' });
    }
    setIsGroupDialogOpen(true);
  };

  const saveGroup = async () => {
    if (!groupForm.name.trim()) { adminNotify.error('Name is required'); return; }
    if (!groupForm.icon.trim()) { adminNotify.error('Icon is required'); return; }
    setIsSaving(true);
    try {
      if (editingGroup) {
        await supabase.from('parent_groups').update({ name: groupForm.name.trim(), icon: groupForm.icon.trim(), color: groupForm.color, description: groupForm.description.trim() }).eq('id', editingGroup.id);
        adminNotify.success('Section updated');
        await refreshGroups();
      } else {
        const slug = groupForm.name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
        const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.sort_order)) : 0;
        await supabase.from('parent_groups').insert({ slug, name: groupForm.name.trim(), icon: groupForm.icon.trim(), color: groupForm.color, description: groupForm.description.trim(), sort_order: maxOrder + 1 });
        adminNotify.success('Section created — use Add Category on this card');
        await refreshGroups();
        // Focus the new section so it isn't buried at the bottom of a long list
        setSelectedGroupSlug(slug);
      }
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      setIsGroupDialogOpen(false);
    } catch (error: any) { adminNotify.error(friendlyError(error)); }
    finally { setIsSaving(false); }
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroup) return;
    setIsDeletingGroup(true);
    try {
      const groupCats = categories.filter(c => c.parent_group === deleteGroup.slug);
      if (groupCats.length > 0) {
        const { data: sellers } = await supabase.from('seller_profiles').select('id').eq('primary_group', deleteGroup.slug).limit(1);
        if (sellers && sellers.length > 0) {
          await supabase.from('parent_groups').update({ is_active: false }).eq('id', deleteGroup.id);
          await supabase.from('category_config').update({ is_active: false }).in('id', groupCats.map(c => c.id));
          setCategories(categories.map(c => c.parent_group === deleteGroup.slug ? { ...c, is_active: false } : c));
          adminNotify.info('Section disabled (sellers are using it)');
        } else {
          await supabase.from('category_config').delete().in('id', groupCats.map(c => c.id));
          await supabase.from('parent_groups').delete().eq('id', deleteGroup.id);
          setCategories(categories.filter(c => c.parent_group !== deleteGroup.slug));
          adminNotify.success('Section and its categories deleted');
        }
      } else {
        await supabase.from('parent_groups').delete().eq('id', deleteGroup.id);
        adminNotify.success('Section deleted');
      }
      queryClient.invalidateQueries({ queryKey: ['category-configs'] });
      await refreshGroups();
      setDeleteGroup(null);
    } catch { adminNotify.error('Failed to delete section'); }
    finally { setIsDeletingGroup(false); }
  };

  const handleGroupDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const filteredGroups = groups.filter(g => !selectedGroupSlug || g.slug === selectedGroupSlug);
    const oldIndex = filteredGroups.findIndex(g => g.id === active.id);
    const newIndex = filteredGroups.findIndex(g => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(filteredGroups, oldIndex, newIndex);
    try {
      await Promise.all(reordered.map((g, i) => supabase.from('parent_groups').update({ sort_order: i }).eq('id', g.id)));
      await refreshGroups();
      adminNotify.success('Section order updated');
    } catch { adminNotify.error('Failed to reorder sections'); await refreshGroups(); }
  }, [groups, selectedGroupSlug, refreshGroups]);

  const handleSubcategoryDragEnd = useCallback(async (groupSlug: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const groupCats = categories.filter(c => c.parent_group === groupSlug).sort((a, b) => a.display_order - b.display_order);
    const oldIndex = groupCats.findIndex(c => c.id === active.id);
    const newIndex = groupCats.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(groupCats, oldIndex, newIndex);
    const orderMap = new Map(reordered.map((c, i) => [c.id, i]));
    setCategories(prev => prev.map(c => orderMap.has(c.id) ? { ...c, display_order: orderMap.get(c.id)! } : c));
    try {
      await Promise.all(reordered.map((c, i) => supabase.from('category_config').update({ display_order: i }).eq('id', c.id)));
      adminNotify.success('Category order updated');
    } catch { adminNotify.error('Failed to reorder categories'); fetchCategories(); }
  }, [categories]);

  const groupedCategories = categories.reduce((acc, cat) => {
    if (!acc[cat.parent_group]) acc[cat.parent_group] = [];
    acc[cat.parent_group].push(cat);
    return acc;
  }, {} as Record<string, CategoryConfigRow[]>);

  const filteredGroups = groups.filter(g => !selectedGroupSlug || g.slug === selectedGroupSlug);

  return {
    categories, setCategories, groups, parentGroupInfos, groupsLoading, isLoading,
    selectedGroupSlug, setSelectedGroupSlug, editingCategory, setEditingCategory,
    editForm, setEditForm, isSaving, isAddDialogOpen, setIsAddDialogOpen,
    addingToGroup, addForm, setAddForm, deleteCategory, setDeleteCategory, isDeleting,
    isGroupDialogOpen, setIsGroupDialogOpen, editingGroup, setEditingGroup,
    groupForm, setGroupForm, deleteGroup, setDeleteGroup, isDeletingGroup,
    sensors, groupedCategories, filteredGroups,
    toggleCategory, openEditDialog, saveEditedCategory, openAddDialog, saveNewCategory,
    confirmDeleteCategory, toggleGroup, openGroupDialog, saveGroup, confirmDeleteGroup,
    handleGroupDragEnd, handleSubcategoryDragEnd,
  };
}
