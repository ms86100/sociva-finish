// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { friendlyError } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export interface PlatformFeature {
  id: string;
  feature_key: string;
  feature_name: string;
  description: string | null;
  category: string;
  is_core: boolean;
  is_experimental: boolean;
  society_configurable: boolean;
}

export interface FeaturePackage {
  id: string;
  package_name: string;
  description: string | null;
  price_tier: string;
  items?: { feature_id: string; enabled: boolean }[];
}

export interface BuilderAssignment {
  id: string;
  builder_id: string;
  package_id: string;
  assigned_at: string;
  expires_at: string | null;
  builder?: { name: string };
  package?: { package_name: string };
}

export const CATEGORIES = ['governance', 'marketplace', 'finance', 'operations', 'construction'];
export const TIERS = ['free', 'basic', 'pro', 'enterprise'];

export function useFeatureManagement() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<PlatformFeature[]>([]);
  const [packages, setPackages] = useState<FeaturePackage[]>([]);
  const [assignments, setAssignments] = useState<BuilderAssignment[]>([]);
  const [builders, setBuilders] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newFeatureOpen, setNewFeatureOpen] = useState(false);
  const [newFeature, setNewFeature] = useState({ feature_key: '', feature_name: '', description: '', category: 'operations', is_core: false, society_configurable: true });
  const [newPkgOpen, setNewPkgOpen] = useState(false);
  const [newPkg, setNewPkg] = useState({ package_name: '', description: '', price_tier: 'free' });
  const [editingPkg, setEditingPkg] = useState<string | null>(null);
  const [pkgItems, setPkgItems] = useState<Record<string, boolean>>({});
  const [showComparison, setShowComparison] = useState(false);
  const [allPkgItems, setAllPkgItems] = useState<Record<string, Record<string, boolean>>>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBuilder, setAssignBuilder] = useState('');
  const [assignPackage, setAssignPackage] = useState('');
  const [manageBuilderId, setManageBuilderId] = useState<string | null>(null);
  const [manageBuilderName, setManageBuilderName] = useState('');

  const fetchAll = useCallback(async () => {
    const [featRes, pkgRes, assignRes, builderRes] = await Promise.all([
      supabase.from('platform_features').select('*').order('category').order('feature_name'),
      supabase.from('feature_packages').select('*').order('price_tier'),
      supabase.from('builder_feature_packages').select('*, builder:builders(name), package:feature_packages(package_name)').order('assigned_at', { ascending: false }),
      supabase.from('builders').select('id, name').eq('is_active', true),
    ]);
    setFeatures((featRes.data as PlatformFeature[]) || []);
    setPackages((pkgRes.data as FeaturePackage[]) || []);
    setAssignments((assignRes.data as any) || []);
    setBuilders((builderRes.data as any) || []);

    const pkgIds = (pkgRes.data || []).map((p: any) => p.id);
    if (pkgIds.length > 0) {
      const { data: allItems } = await supabase.from('feature_package_items').select('package_id, feature_id, enabled').in('package_id', pkgIds);
      const grouped: Record<string, Record<string, boolean>> = {};
      (allItems || []).forEach((item: any) => {
        if (!grouped[item.package_id]) grouped[item.package_id] = {};
        grouped[item.package_id][item.feature_id] = item.enabled;
      });
      setAllPkgItems(grouped);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createFeature = async () => {
    if (!newFeature.feature_key || !newFeature.feature_name) return;
    const { error } = await supabase.from('platform_features').insert(newFeature);
    if (error) { toast.error(friendlyError(error)); return; }
    await logAudit('feature_created', 'platform_feature', '', null, { feature_key: newFeature.feature_key });
    toast.success('Feature created');
    setNewFeatureOpen(false);
    setNewFeature({ feature_key: '', feature_name: '', description: '', category: 'operations', is_core: false, society_configurable: true });
    fetchAll();
  };

  const toggleFeatureField = async (id: string, field: string, value: boolean) => {
    await supabase.from('platform_features').update({ [field]: value }).eq('id', id);
    await logAudit('feature_updated', 'platform_feature', id, null, { field, value });
    fetchAll();
  };

  const createPackage = async () => {
    if (!newPkg.package_name) return;
    const { error } = await supabase.from('feature_packages').insert(newPkg);
    if (error) { toast.error(friendlyError(error)); return; }
    await logAudit('package_created', 'feature_package', '', null, { name: newPkg.package_name });
    toast.success('Package created');
    setNewPkgOpen(false);
    setNewPkg({ package_name: '', description: '', price_tier: 'free' });
    fetchAll();
  };

  const openPackageEditor = async (pkgId: string) => {
    setEditingPkg(pkgId);
    const { data } = await supabase.from('feature_package_items').select('feature_id, enabled').eq('package_id', pkgId);
    const items: Record<string, boolean> = {};
    (data || []).forEach(d => { items[d.feature_id] = d.enabled; });
    setPkgItems(items);
  };

  const togglePkgItem = async (featureId: string, enabled: boolean) => {
    if (!editingPkg) return;
    setPkgItems(prev => ({ ...prev, [featureId]: enabled }));
    if (enabled) {
      await supabase.from('feature_package_items').upsert({ package_id: editingPkg, feature_id: featureId, enabled: true }, { onConflict: 'package_id,feature_id' });
    } else {
      await supabase.from('feature_package_items').delete().eq('package_id', editingPkg).eq('feature_id', featureId);
      setPkgItems(prev => { const n = { ...prev }; delete n[featureId]; return n; });
    }
    await logAudit('package_modified', 'feature_package', editingPkg, null, { feature_id: featureId, enabled });
  };

  const assignPackageToBuilder = async () => {
    if (!assignBuilder || !assignPackage) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('builder_feature_packages').insert({ builder_id: assignBuilder, package_id: assignPackage, assigned_by: user?.id });
    if (error) {
      if (error.code === '23505') toast.error('Already assigned');
      else toast.error(friendlyError(error));
      return;
    }
    await logAudit('package_assigned_to_builder', 'builder_feature_package', assignBuilder, null, { package_id: assignPackage });
    toast.success('Package assigned');
    setAssignOpen(false); setAssignBuilder(''); setAssignPackage('');
    fetchAll();
  };

  const removeAssignment = async (id: string, builderId: string, packageId: string) => {
    await supabase.from('builder_feature_packages').delete().eq('id', id);
    await logAudit('package_removed_from_builder', 'builder_feature_package', builderId, null, { package_id: packageId });
    toast.success('Assignment removed');
    fetchAll();
  };

  const groupedFeatures = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = features.filter(f => f.category === cat);
    return acc;
  }, {} as Record<string, PlatformFeature[]>);

  return {
    features, packages, assignments, builders, isLoading, groupedFeatures,
    newFeatureOpen, setNewFeatureOpen, newFeature, setNewFeature, createFeature,
    newPkgOpen, setNewPkgOpen, newPkg, setNewPkg, createPackage,
    editingPkg, setEditingPkg, pkgItems, openPackageEditor, togglePkgItem,
    showComparison, setShowComparison, allPkgItems,
    assignOpen, setAssignOpen, assignBuilder, setAssignBuilder, assignPackage, setAssignPackage,
    manageBuilderId, setManageBuilderId, manageBuilderName, setManageBuilderName,
    toggleFeatureField, assignPackageToBuilder, removeAssignment, fetchAll,
  };
}
