// @ts-nocheck
import React, { useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { loadAppBootstrap } from '@/lib/app-bootstrap';

import { AuthContextType } from './types';
import { useAuthState } from './useAuthState';
import {
  IdentityContext, IdentityContextType,
  RoleContext, RoleContextType,
  SocietyContext, SocietyContextType,
  SellerContext, SellerContextType,
} from './contexts';
import { createContext, useContext } from 'react';

// Legacy combined context — kept for backward compatibility
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { state, setPartial, refreshProfile, setViewAsSociety, signOut } = useAuthState();
  const queryClient = useQueryClient();

  const {
    user, session, profile, society, roles, sellerProfiles,
    currentSellerId, isLoading, societyAdminRole, managedBuilderIds,
    viewAsSocietyId, viewAsSociety, isSecurityOfficer, isWorker,
    isSessionRestored, isProfileLoading, profileError, isSigningOut,
  } = state;

  const isApproved = profile?.verification_status === 'approved';
  // Derive seller flags from sellerProfiles state — don't gate on role alone
  // This ensures the UI updates immediately when seller_profiles changes via realtime
  const isSeller = sellerProfiles.some(s => (s as any).verification_status === 'approved');
  const hasSellerProfile = sellerProfiles.length > 0;
  const isAdmin = roles.includes('admin');
  const isSocietyAdmin = !!societyAdminRole || isAdmin;
  const isBuilderMember = managedBuilderIds.length > 0;

  const effectiveSocietyId = viewAsSocietyId || profile?.society_id || null;
  const effectiveSociety = viewAsSocietyId ? viewAsSociety : society;

  // Perf: Defer non-critical prefetches — only fire after a short idle delay
  // This prevents auth restore from triggering a burst of queries that slows the first click
  useEffect(() => {
    if (!effectiveSocietyId || !profile) return;
    const LONG_STALE = 30 * 60 * 1000; // 30 min for near-static config
    // Defer prefetches by 2s so they don't compete with the first route's data
    const timer = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['category-configs'],
        queryFn: fetchCategoryConfigs,
        staleTime: LONG_STALE,
      });
      // PERF: badge-config and parent-groups now come from the shared
      // single-request bootstrap (same one fetchCategoryConfigs uses), so all
      // three prefetches together cost at most ONE round-trip.
      queryClient.prefetchQuery({
        queryKey: ['badge-config'],
        queryFn: async () => (await loadAppBootstrap()).badgeConfigRows,
        staleTime: LONG_STALE,
      });
      queryClient.prefetchQuery({
        queryKey: ['parent-groups'],
        queryFn: async () => (await loadAppBootstrap()).parentGroupRows,
        staleTime: LONG_STALE,
      });

      queryClient.prefetchQuery({
        queryKey: ['effective-features', effectiveSocietyId],
        queryFn: async () => {
          const { data } = await supabase.rpc('get_effective_society_features', {
            _society_id: effectiveSocietyId,
          });
          return data || [];
        },
        staleTime: 15 * 60 * 1000,
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [effectiveSocietyId, !!profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Memoized sub-context values ───────────────────────
  // Perf: use primitive deps to prevent re-renders from object reference changes
  const identityValue = useMemo<IdentityContextType>(() => {
    return {
      user, session, isLoading, isSessionRestored,
      isProfileLoading, profileError, isSigningOut,
      signOut, refreshProfile,
    };
  }, [
    user?.id, !!session, isLoading, isSessionRestored,
    isProfileLoading, profileError, isSigningOut,
    signOut, refreshProfile,
  ]);

  const roleValue = useMemo<RoleContextType>(() => ({
    profile, roles, isApproved, isAdmin, isSocietyAdmin,
    isBuilderMember, societyAdminRole, managedBuilderIds,
  }), [profile, roles, isApproved, isAdmin, isSocietyAdmin, isBuilderMember, societyAdminRole, managedBuilderIds]);

  const societyValue = useMemo<SocietyContextType>(() => ({
    society, viewAsSocietyId, setViewAsSociety,
    effectiveSocietyId, effectiveSociety,
  }), [society, viewAsSocietyId, setViewAsSociety, effectiveSocietyId, effectiveSociety]);

  const sellerValue = useMemo<SellerContextType>(() => ({
    sellerProfiles, currentSellerId, isSeller,
    setCurrentSellerId: (id: string | null) => setPartial({ currentSellerId: id }),
  }), [sellerProfiles, currentSellerId, isSeller, setPartial]);

  // Fix #9: Memoize legacy value to prevent entire app tree re-renders
  const setCurrentSellerId = useMemo(() => (id: string | null) => setPartial({ currentSellerId: id }), [setPartial]);

  const legacyValue = useMemo<AuthContextType>(() => ({
    user, session, profile, society, roles, sellerProfiles,
    currentSellerId, isLoading, isSessionRestored,
    isProfileLoading, profileError, isSigningOut,
    isApproved, isSeller, hasSellerProfile, isAdmin,
    isSocietyAdmin, isBuilderMember, isSecurityOfficer, isWorker,
    societyAdminRole, managedBuilderIds,
    signOut, refreshProfile,
    setCurrentSellerId,
    viewAsSocietyId, setViewAsSociety,
    effectiveSocietyId, effectiveSociety,
  }), [
    user, session, profile, society, roles, sellerProfiles,
    currentSellerId, isLoading, isSessionRestored,
    isProfileLoading, profileError, isSigningOut,
    isApproved, isSeller, hasSellerProfile, isAdmin,
    isSocietyAdmin, isBuilderMember, isSecurityOfficer, isWorker,
    societyAdminRole, managedBuilderIds,
    signOut, refreshProfile, setCurrentSellerId,
    viewAsSocietyId, setViewAsSociety, effectiveSocietyId, effectiveSociety,
  ]);

  return (
    <IdentityContext.Provider value={identityValue}>
      <RoleContext.Provider value={roleValue}>
        <SocietyContext.Provider value={societyValue}>
          <SellerContext.Provider value={sellerValue}>
            <AuthContext.Provider value={legacyValue}>
              {children}
            </AuthContext.Provider>
          </SellerContext.Provider>
        </SocietyContext.Provider>
      </RoleContext.Provider>
    </IdentityContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
