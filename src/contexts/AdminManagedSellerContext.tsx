import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SellerProfile } from '@/types/Database';

const STORAGE_KEY = 'sociva.adminManagedSellerId';

type AdminManagedSellerContextValue = {
  managedSellerId: string | null;
  managedSellerProfile: SellerProfile | null;
  isManagingStore: boolean;
  setManagedSeller: (sellerId: string | null) => void;
  clearManagedSeller: () => void;
  loadingProfile: boolean;
};

const AdminManagedSellerContext = createContext<AdminManagedSellerContextValue | null>(null);

export function AdminManagedSellerProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [managedSellerId, setManagedSellerIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [managedSellerProfile, setManagedSellerProfile] = useState<SellerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const setManagedSeller = useCallback((sellerId: string | null) => {
    if (!isAdmin) return;
    setManagedSellerIdState(sellerId);
    try {
      if (sellerId) sessionStorage.setItem(STORAGE_KEY, sellerId);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [isAdmin]);

  const clearManagedSeller = useCallback(() => setManagedSeller(null), [setManagedSeller]);

  useEffect(() => {
    if (!isAdmin) {
      setManagedSellerIdState(null);
      setManagedSellerProfile(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !managedSellerId) {
      setManagedSellerProfile(null);
      setLoadingProfile(false);
      return;
    }
    let cancelled = false;
    setLoadingProfile(true);
    (async () => {
      const { data } = await supabase
        .from('seller_profiles')
        .select('*')
        .eq('id', managedSellerId)
        .maybeSingle();
      if (cancelled) return;
      setManagedSellerProfile((data as SellerProfile) || null);
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, managedSellerId]);

  const value = useMemo<AdminManagedSellerContextValue>(
    () => ({
      managedSellerId: isAdmin ? managedSellerId : null,
      managedSellerProfile: isAdmin ? managedSellerProfile : null,
      isManagingStore: !!(isAdmin && managedSellerId),
      setManagedSeller,
      clearManagedSeller,
      loadingProfile,
    }),
    [isAdmin, managedSellerId, managedSellerProfile, setManagedSeller, clearManagedSeller, loadingProfile],
  );

  return (
    <AdminManagedSellerContext.Provider value={value}>
      {children}
    </AdminManagedSellerContext.Provider>
  );
}

export function useAdminManagedSeller() {
  const ctx = useContext(AdminManagedSellerContext);
  if (!ctx) {
    return {
      managedSellerId: null,
      managedSellerProfile: null,
      isManagingStore: false,
      setManagedSeller: (_id: string | null) => {},
      clearManagedSeller: () => {},
      loadingProfile: false,
    } satisfies AdminManagedSellerContextValue;
  }
  return ctx;
}

export function adminStorePaths(sellerId: string) {
  const base = `/admin/stores/${sellerId}`;
  return {
    hub: base,
    products: `${base}/products`,
    productsNew: `${base}/products/new`,
    productEdit: (productId: string) => `${base}/products/${productId}/edit`,
    settings: `${base}/settings`,
    back: '/admin/stores',
  };
}

export const SELLER_STORE_PATHS = {
  hub: '/seller',
  products: '/seller/products',
  productsNew: '/seller/products/new',
  productEdit: (productId: string) => `/seller/products/${productId}/edit`,
  settings: '/seller/settings',
  back: '/seller',
};
