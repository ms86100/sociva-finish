// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type FeatureKey =
  | 'marketplace'
  | 'bulletin'
  | 'disputes'
  | 'finances'
  | 'construction_progress'
  | 'snag_management'
  | 'help_requests'
  | 'visitor_management'
  | 'domestic_help'
  | 'parcel_management'
  | 'inspection'
  | 'payment_milestones'
  | 'maintenance'
  | 'guard_kiosk'
  | 'vehicle_parking'
  | 'resident_identity_verification'
  | 'worker_marketplace'
  | 'workforce_management'
  | 'society_notices'
  | 'delivery_management'
  | 'worker_attendance'
  | 'worker_salary'
  | 'worker_leave'
  | 'security_audit'
  | 'seller_tools'
  | 'gate_entry'
  | 'collective_buy'
  | 'authorized_persons'
  | 'society_reports'
  | 'subscriptions'
  | 'trust_directory'
  | 'community_rules'
  | 'trust_score'
  | 'monthly_report_card'
  | 'notifications';

export type FeatureState = 'enabled' | 'disabled' | 'locked' | 'unavailable';

interface EffectiveFeature {
  feature_key: string;
  is_enabled: boolean;
  source: string; // 'core' | 'package' | 'override' | 'default'
  society_configurable: boolean;
  display_name: string | null;
  description: string | null;
  icon_name: string | null;
}

export function useEffectiveFeatures() {
  const { effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();

  const { data: features = [], isLoading, isError } = useQuery({
    queryKey: ['effective-features', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data, error } = await supabase.rpc('get_effective_society_features', {
        _society_id: effectiveSocietyId,
      });
      if (error) {
        console.error('Error fetching effective features:', error);
        throw error;
      }
      return (data || []) as EffectiveFeature[];
    },
    enabled: !!effectiveSocietyId,
    staleTime: 15 * 60 * 1000, // 15 min — features rarely change mid-session
    retry: 2,
  });

  // Fix #16: Memoize featureMap and all accessor functions
  const featureMap = useMemo(() => new Map(features.map(f => [f.feature_key, f])), [features]);

  const { isAdmin } = useAuth();

  // Marketplace-domain features: always enabled regardless of society context.
  // Society-domain features (everything else) require effectiveSocietyId.
  const MARKETPLACE_FEATURES: Set<string> = useMemo(() => new Set([
    'marketplace', 'seller_tools', 'trust_directory', 'trust_score',
    'subscriptions', 'notifications',
  ]), []);

  const isFeatureEnabled = useCallback((key: FeatureKey): boolean => {
    if (isAdmin) return true; // Platform admins bypass all feature gates
    // Marketplace-domain features are always enabled even without a society
    if (MARKETPLACE_FEATURES.has(key)) return true;
    if (!effectiveSocietyId) return false;
    const feature = featureMap.get(key);
    if (!feature) return false;
    return feature.is_enabled;
  }, [isAdmin, effectiveSocietyId, featureMap, MARKETPLACE_FEATURES]);

  const getFeatureState = useCallback((key: FeatureKey): FeatureState => {
    const feature = featureMap.get(key);
    if (!feature) return 'unavailable';
    if (feature.source === 'core') return 'locked';
    if (!feature.society_configurable) return feature.is_enabled ? 'locked' : 'disabled';
    return feature.is_enabled ? 'enabled' : 'disabled';
  }, [featureMap]);

  const getFeatureSource = useCallback((key: FeatureKey): string => {
    return featureMap.get(key)?.source || 'default';
  }, [featureMap]);

  const getFeatureDisplayName = useCallback((key: FeatureKey): string => {
    return featureMap.get(key)?.display_name || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, [featureMap]);

  const getFeatureDescription = useCallback((key: FeatureKey): string => {
    return featureMap.get(key)?.description || '';
  }, [featureMap]);

  const isConfigurable = useCallback((key: FeatureKey): boolean => {
    const feature = featureMap.get(key);
    if (!feature) return false;
    if (feature.source === 'core') return false;
    return feature.society_configurable;
  }, [featureMap]);

  const toggleFeature = useMutation({
    mutationFn: async ({ key, enabled }: { key: FeatureKey; enabled: boolean }) => {
      if (!effectiveSocietyId) throw new Error('No society');
      
      // Get feature_id from platform_features
      const { data: pf } = await supabase
        .from('platform_features')
        .select('id')
        .eq('feature_key', key)
        .single();
      
      if (!pf) throw new Error('Feature not found');

      const { data: { user } } = await supabase.auth.getUser();
      
      // Upsert into society_feature_overrides
      const { error } = await supabase
        .from('society_feature_overrides')
        .upsert({
          society_id: effectiveSocietyId,
          feature_id: pf.id,
          is_enabled: enabled,
          overridden_by: user?.id,
          overridden_at: new Date().toISOString(),
        }, { onConflict: 'society_id,feature_id' });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['effective-features', effectiveSocietyId] });
    },
  });

  // Fix #16: Memoize the entire return value
  return useMemo(() => ({
    features,
    isLoading,
    isError,
    isFeatureEnabled,
    getFeatureState,
    getFeatureSource,
    getFeatureDisplayName,
    getFeatureDescription,
    isConfigurable,
    toggleFeature,
  }), [features, isLoading, isError, isFeatureEnabled, getFeatureState, getFeatureSource, getFeatureDisplayName, getFeatureDescription, isConfigurable, toggleFeature]);
}
