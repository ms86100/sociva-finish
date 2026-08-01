// @ts-nocheck
import { createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { Profile, UserRole, SellerProfile, Society, SocietyAdmin } from '@/types/database';

// ── Identity Context ──────────────────────────────────────
// Auth session, user, loading state, sign-out
export interface IdentityContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /** True once initial session restoration from storage has completed */
  isSessionRestored: boolean;
  isProfileLoading: boolean;
  profileError: string | null;
  isSigningOut: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const IdentityContext = createContext<IdentityContextType | undefined>(undefined);

export function useIdentity(): IdentityContextType {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within AuthProvider');
  return ctx;
}

// ── Role Context ──────────────────────────────────────────
// Roles, admin status, builder membership
export interface RoleContextType {
  profile: Profile | null;
  roles: UserRole[];
  isApproved: boolean;
  isAdmin: boolean;
  isSocietyAdmin: boolean;
  isBuilderMember: boolean;
  societyAdminRole: SocietyAdmin | null;
  managedBuilderIds: string[];
}

export const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function useRoles(): RoleContextType {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRoles must be used within AuthProvider');
  return ctx;
}

// ── Society Context ───────────────────────────────────────
// Society info, view-as switching, effective society
export interface SocietyContextType {
  society: Society | null;
  viewAsSocietyId: string | null;
  setViewAsSociety: (id: string | null) => void;
  effectiveSocietyId: string | null;
  effectiveSociety: Society | null;
}

export const SocietyContext = createContext<SocietyContextType | undefined>(undefined);

export function useSocietyContext(): SocietyContextType {
  const ctx = useContext(SocietyContext);
  if (!ctx) throw new Error('useSocietyContext must be used within AuthProvider');
  return ctx;
}

// ── Seller Context ────────────────────────────────────────
// Seller profiles, current seller selection
export interface SellerContextType {
  sellerProfiles: SellerProfile[];
  currentSellerId: string | null;
  isSeller: boolean;
  setCurrentSellerId: (id: string | null) => void;
}

export const SellerContext = createContext<SellerContextType | undefined>(undefined);

export function useSellerContext(): SellerContextType {
  const ctx = useContext(SellerContext);
  if (!ctx) throw new Error('useSellerContext must be used within AuthProvider');
  return ctx;
}
