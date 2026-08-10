// @ts-nocheck
import { User, Session } from '@supabase/supabase-js';
import { Profile, UserRole, SellerProfile, Society, SocietyAdmin } from '@/types/Database';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  society: Society | null;
  roles: UserRole[];
  sellerProfiles: SellerProfile[];
  currentSellerId: string | null;
  isLoading: boolean;
  /** True once initial session restoration from storage has completed */
  isSessionRestored: boolean;
  /** True while get_user_auth_context is in flight for the current user */
  isProfileLoading: boolean;
  /** Set when profile fetch exhausted retries */
  profileError: string | null;
  /** True while explicit sign-out is clearing session (blocks /auth bounce) */
  isSigningOut: boolean;
  isApproved: boolean;
  isSeller: boolean;
  hasSellerProfile: boolean;
  isAdmin: boolean;
  isSocietyAdmin: boolean;
  isBuilderMember: boolean;
  isSecurityOfficer: boolean;
  isWorker: boolean;
  societyAdminRole: SocietyAdmin | null;
  managedBuilderIds: string[];
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setCurrentSellerId: (id: string | null) => void;
  viewAsSocietyId: string | null;
  setViewAsSociety: (id: string | null) => void;
  effectiveSocietyId: string | null;
  effectiveSociety: Society | null;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  society: Society | null;
  roles: UserRole[];
  sellerProfiles: SellerProfile[];
  currentSellerId: string | null;
  isLoading: boolean;
  /** True once initial session restoration from storage has completed (regardless of outcome) */
  isSessionRestored: boolean;
  isProfileLoading: boolean;
  profileError: string | null;
  isSigningOut: boolean;
  isSecurityOfficer: boolean;
  isWorker: boolean;
  societyAdminRole: SocietyAdmin | null;
  managedBuilderIds: string[];
  viewAsSocietyId: string | null;
  viewAsSociety: Society | null;
}

export const initialAuthState: AuthState = {
  user: null,
  session: null,
  profile: null,
  society: null,
  roles: [],
  sellerProfiles: [],
  currentSellerId: null,
  isLoading: true,
  isSessionRestored: false,
  isProfileLoading: false,
  profileError: null,
  isSigningOut: false,
  isSecurityOfficer: false,
  isWorker: false,
  societyAdminRole: null,
  managedBuilderIds: [],
  viewAsSocietyId: null,
  viewAsSociety: null,
};
