import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export type CommandCenterSnapshot = {
  society_id: string | null;
  as_of: string;
  sellers: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    active: number;
    on_vacation: number;
    ready_surface: number;
  };
  listings: {
    total_products: number;
    live_products: number;
    pending_products: number;
    rejected_products: number;
    inactive_products: number;
  };
  orders: {
    total: number;
    today: number;
    week: number;
    month: number;
    payment_pending: number;
    by_status: Array<{ status: string; count: number }>;
  };
  bookings: {
    total: number;
    by_status: Array<{ status: string; count: number }>;
  };
  enquiries: { open: number };
  disputes: { open: number; total: number };
  refunds: { open: number };
  attention: {
    pending_store_verifications: number;
    pending_product_approvals: number;
    open_disputes: number;
    open_refunds: number;
    payment_pending_orders: number;
  };
};

export type CommandCenterSellerRow = {
  seller_id: string;
  business_name: string;
  verification_status: string;
  is_available: boolean;
  vacation_mode: boolean;
  society_id: string | null;
  society_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  created_at: string;
  product_count: number;
  live_product_count: number;
  orders_30d: number;
};

export type CommandCenterOrderRow = {
  order_id: string;
  status: string;
  payment_status: string;
  payment_type: string | null;
  order_type: string | null;
  total_amount: number;
  society_id: string | null;
  society_name: string | null;
  seller_id: string;
  seller_name: string | null;
  buyer_id: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  created_at: string;
};

export type SellerListFilters = {
  verificationStatus?: string | null;
  activeOnly?: boolean | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type OrderListFilters = {
  status?: string | null;
  paymentStatus?: string | null;
  sellerId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export function useCommandCenterSnapshot(societyId: string | null | undefined) {
  return useQuery({
    queryKey: ['admin-command-center-snapshot', societyId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_get_command_center_snapshot', {
        p_society_id: societyId || null,
      });
      if (error) throw error;
      return (data || {}) as CommandCenterSnapshot;
    },
    staleTime: 30_000,
  });
}

export function useCommandCenterSellers(
  societyId: string | null | undefined,
  filters: SellerListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-sellers',
      societyId ?? 'all',
      filters.verificationStatus ?? 'all',
      filters.activeOnly ?? 'any',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_sellers_filtered', {
        p_society_id: societyId || null,
        p_verification_status: filters.verificationStatus || null,
        p_active_only: filters.activeOnly ?? null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const payload = (data || {}) as { total?: number; rows?: CommandCenterSellerRow[] };
      return {
        total: Number(payload.total || 0),
        rows: Array.isArray(payload.rows) ? payload.rows : [],
      };
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterOrders(
  societyId: string | null | undefined,
  filters: OrderListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-orders',
      societyId ?? 'all',
      filters.status ?? 'all',
      filters.paymentStatus ?? 'all',
      filters.sellerId ?? 'all',
      filters.from ?? 'all',
      filters.to ?? 'all',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_orders_filtered', {
        p_society_id: societyId || null,
        p_status: filters.status || null,
        p_payment_status: filters.paymentStatus || null,
        p_seller_id: filters.sellerId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const payload = (data || {}) as { total?: number; rows?: CommandCenterOrderRow[] };
      return {
        total: Number(payload.total || 0),
        rows: Array.isArray(payload.rows) ? payload.rows : [],
      };
    },
    staleTime: 20_000,
  });
}
