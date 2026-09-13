// @ts-nocheck
import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminManagedSeller } from '@/contexts/AdminManagedSellerContext';
import SellerProductsPage from '@/pages/SellerProductsPage';
import SellerProductFormPage from '@/pages/SellerProductFormPage';
import SellerSettingsPage from '@/pages/SellerSettingsPage';

function useBindManagedSeller() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const { isAdmin } = useAuth();
  const { setManagedSeller } = useAdminManagedSeller();
  useEffect(() => {
    if (isAdmin && sellerId) setManagedSeller(sellerId);
  }, [isAdmin, sellerId, setManagedSeller]);
  return { sellerId, isAdmin };
}

export function AdminManagedSellerProductsPage() {
  const { sellerId, isAdmin } = useBindManagedSeller();
  if (!isAdmin) return <Navigate to="/" replace />;
  if (!sellerId) return <Navigate to="/admin/stores" replace />;
  return <SellerProductsPage sellerIdOverride={sellerId} />;
}

export function AdminManagedSellerProductFormPage() {
  const { sellerId, isAdmin } = useBindManagedSeller();
  if (!isAdmin) return <Navigate to="/" replace />;
  if (!sellerId) return <Navigate to="/admin/stores" replace />;
  return <SellerProductFormPage sellerIdOverride={sellerId} />;
}

export function AdminManagedSellerSettingsPage() {
  const { sellerId, isAdmin } = useBindManagedSeller();
  if (!isAdmin) return <Navigate to="/" replace />;
  if (!sellerId) return <Navigate to="/admin/stores" replace />;
  return <SellerSettingsPage sellerIdOverride={sellerId} />;
}
