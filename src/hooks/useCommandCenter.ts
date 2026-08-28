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
    suspended?: number;
    draft?: number;
    completed_onboarding?: number;
    active: number;
    inactive?: number;
    on_vacation: number;
    ready_surface: number;
  };
  listings: {
    total_products: number;
    live_products: number;
    pending_products: number;
    rejected_products: number;
    inactive_products: number;
    total_services?: number;
    live_services?: number;
    pending_services?: number;
  };
  orders: {
    total: number;
    today: number;
    week: number;
    month: number;
    payment_pending: number;
    disputed?: number;
    by_status: Array<{ status: string; count: number }>;
  };
  bookings: {
    total: number;
    by_status: Array<{ status: string; count: number }>;
  };
  enquiries: {
    open: number;
    total?: number;
    new?: number;
    responded?: number;
    unanswered?: number;
    closed?: number;
  };
  disputes: {
    open: number;
    total: number;
    under_review?: number;
    resolved?: number;
  };
  refunds: { open: number };
  attention: {
    pending_store_verifications: number;
    pending_product_approvals: number;
    open_disputes: number;
    open_refunds: number;
    payment_pending_orders: number;
    unanswered_enquiries?: number;
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
  rating?: number | null;
  total_reviews?: number | null;
  fulfillment_mode?: string | null;
  last_active_at?: string | null;
  unanswered_enquiries?: number;
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
  fulfillment_type?: string | null;
  delivery_handled_by?: string | null;
  product_summary?: string | null;
  categories?: string | null;
  has_dispute?: boolean;
  dispute_status?: string | null;
};

export type CommandCenterProductRow = {
  product_id: string;
  name: string;
  category: string | null;
  subcategory_id: string | null;
  subcategory_name: string | null;
  price: number;
  approval_status: string;
  is_available: boolean;
  seller_id: string;
  seller_name: string | null;
  society_id: string | null;
  society_name: string | null;
  is_service: boolean;
  created_at: string;
  updated_at: string | null;
};

export type CommandCenterBookingRow = {
  booking_id: string;
  status: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  location_type: string | null;
  seller_id: string;
  seller_name: string | null;
  buyer_id: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  order_id: string | null;
  created_at: string;
};

export type CommandCenterEnquiryRow = {
  enquiry_id: string;
  status: string;
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
  updated_at: string | null;
  product_summary?: string | null;
  has_conversation?: boolean;
  seller_responded?: boolean;
  conversation_id?: string | null;
};

export type CommandCenterDisputeRow = {
  dispute_id: string;
  dispute_kind: 'order_dispute' | 'society_ticket' | string;
  status: string;
  reason: string | null;
  order_id: string | null;
  seller_id: string | null;
  seller_name: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type CommandCenterActivityRow = {
  event_type: string;
  entity_id: string;
  occurred_at: string;
  actor_name: string | null;
  target_name: string | null;
  detail: string | null;
  seller_id: string | null;
  amount: number | null;
};

export type Store360Data = {
  seller_id: string;
  business_name: string;
  description: string | null;
  verification_status: string;
  is_available: boolean;
  vacation_mode: boolean;
  society_id: string | null;
  society_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  created_at: string;
  last_active_at: string | null;
  categories: string[] | null;
  fulfillment_mode: string | null;
  delivery_radius_km: number | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  total_reviews: number | null;
  completed_order_count: number | null;
  cancellation_rate: number | null;
  reliability_score: number | null;
  avg_response_minutes: number | null;
  activity: {
    orders_total: number;
    orders_30d: number;
    orders_completed: number;
    orders_cancelled: number;
    bookings_total: number;
    bookings_completed: number;
    enquiries_total: number;
    enquiries_unanswered: number;
  };
  listings: {
    total: number;
    live: number;
    pending: number;
    services: number;
  };
  quality: {
    open_disputes: number;
    open_refunds: number;
    avg_review_rating: number | null;
    review_count: number;
  };
  recent_orders: Array<{
    order_id: string;
    status: string;
    total_amount: number;
    created_at: string;
    buyer_name: string | null;
  }>;
  recent_products: Array<{
    product_id: string;
    name: string;
    approval_status: string;
    is_available: boolean;
    price: number;
    category: string | null;
  }>;
  recent_reviews: Array<{
    review_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    buyer_name: string | null;
  }>;
};

export type GlobalSearchResult = {
  sellers: Array<{ seller_id: string; name: string; status: string; kind: string }>;
  products: Array<{
    product_id: string;
    name: string;
    category: string | null;
    status: string;
    seller_name: string | null;
    seller_id: string;
  }>;
  orders: Array<{
    order_id: string;
    status: string;
    total_amount: number;
    seller_name: string | null;
    buyer_name: string | null;
    seller_id: string;
  }>;
  bookings: Array<{
    booking_id: string;
    status: string;
    seller_name: string | null;
    product_name: string | null;
    seller_id: string;
  }>;
  enquiries: Array<{
    enquiry_id: string;
    status: string;
    seller_name: string | null;
    buyer_name: string | null;
    seller_id: string;
  }>;
  disputes: Array<{
    dispute_id: string;
    status: string;
    dispute_kind: string;
    seller_name: string | null;
    seller_id: string | null;
    order_id: string | null;
  }>;
};

export type CategoryIntelligenceData = {
  level: 'root' | 'category' | 'subcategory';
  category?: string | null;
  subcategory_id?: string | null;
  subcategory_name?: string | null;
  categories?: Array<{
    category: string;
    product_count: number;
    seller_count: number;
    orders_30d: number;
  }>;
  subcategories?: Array<{
    subcategory_id: string;
    subcategory_name: string;
    product_count: number;
    seller_count: number;
  }>;
  sellers?: Array<{
    seller_id: string;
    business_name: string;
    product_count: number;
    orders_30d: number;
  }>;
  products?: Array<{
    product_id: string;
    name: string;
    price: number;
    approval_status: string;
    is_available: boolean;
    seller_name: string | null;
    seller_id: string;
  }>;
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

export type ProductListFilters = {
  approvalStatus?: string | null;
  category?: string | null;
  sellerId?: string | null;
  availableOnly?: boolean | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type BookingListFilters = {
  status?: string | null;
  sellerId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type EnquiryListFilters = {
  status?: string | null;
  sellerId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type DisputeListFilters = {
  status?: string | null;
  sellerId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ActivityListFilters = {
  eventType?: string | null;
  sellerId?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
};

function listPayload<T>(data: unknown): { total: number; rows: T[] } {
  const payload = (data || {}) as { total?: number; rows?: T[] };
  return {
    total: Number(payload.total || 0),
    rows: Array.isArray(payload.rows) ? payload.rows : [],
  };
}

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
      return listPayload<CommandCenterSellerRow>(data);
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
      return listPayload<CommandCenterOrderRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterProducts(
  societyId: string | null | undefined,
  filters: ProductListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-products',
      societyId ?? 'all',
      filters.approvalStatus ?? 'all',
      filters.category ?? 'all',
      filters.sellerId ?? 'all',
      filters.availableOnly ?? 'any',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_products_filtered', {
        p_society_id: societyId || null,
        p_approval_status: filters.approvalStatus || null,
        p_category: filters.category || null,
        p_seller_id: filters.sellerId || null,
        p_available_only: filters.availableOnly ?? null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return listPayload<CommandCenterProductRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterBookings(
  societyId: string | null | undefined,
  filters: BookingListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-bookings',
      societyId ?? 'all',
      filters.status ?? 'all',
      filters.sellerId ?? 'all',
      filters.from ?? 'all',
      filters.to ?? 'all',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_bookings_filtered', {
        p_society_id: societyId || null,
        p_status: filters.status || null,
        p_seller_id: filters.sellerId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return listPayload<CommandCenterBookingRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterEnquiries(
  societyId: string | null | undefined,
  filters: EnquiryListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-enquiries',
      societyId ?? 'all',
      filters.status ?? 'all',
      filters.sellerId ?? 'all',
      filters.from ?? 'all',
      filters.to ?? 'all',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_enquiries_filtered', {
        p_society_id: societyId || null,
        p_status: filters.status || null,
        p_seller_id: filters.sellerId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return listPayload<CommandCenterEnquiryRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterDisputes(
  societyId: string | null | undefined,
  filters: DisputeListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: [
      'admin-command-center-disputes',
      societyId ?? 'all',
      filters.status ?? 'all',
      filters.sellerId ?? 'all',
      filters.from ?? 'all',
      filters.to ?? 'all',
      filters.search ?? '',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_disputes_filtered', {
        p_society_id: societyId || null,
        p_status: filters.status || null,
        p_seller_id: filters.sellerId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_search: filters.search?.trim() || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return listPayload<CommandCenterDisputeRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterActivity(
  societyId: string | null | undefined,
  filters: ActivityListFilters,
) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;

  return useQuery({
    queryKey: [
      'admin-command-center-activity',
      societyId ?? 'all',
      filters.eventType ?? 'all',
      filters.sellerId ?? 'all',
      filters.from ?? 'all',
      filters.to ?? 'all',
      page,
      pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_activity_timeline', {
        p_society_id: societyId || null,
        p_event_type: filters.eventType || null,
        p_seller_id: filters.sellerId || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return listPayload<CommandCenterActivityRow>(data);
    },
    staleTime: 20_000,
  });
}

export function useCommandCenterStore360(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ['admin-command-center-store-360', sellerId],
    enabled: Boolean(sellerId),
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_get_store_360', {
        p_seller_id: sellerId,
      });
      if (error) throw error;
      return (data || {}) as Store360Data;
    },
    staleTime: 30_000,
  });
}

export function useCommandCenterGlobalSearch(
  societyId: string | null | undefined,
  query: string,
) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['admin-command-center-global-search', societyId ?? 'all', trimmed],
    enabled: trimmed.length >= 2,
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_global_search', {
        p_query: trimmed,
        p_society_id: societyId || null,
        p_limit: 8,
      });
      if (error) throw error;
      return (data || {
        sellers: [],
        products: [],
        orders: [],
        bookings: [],
        enquiries: [],
        disputes: [],
      }) as GlobalSearchResult;
    },
    staleTime: 10_000,
  });
}

export function useCommandCenterCategoryIntelligence(
  societyId: string | null | undefined,
  category: string | null | undefined,
  subcategoryId: string | null | undefined,
) {
  return useQuery({
    queryKey: [
      'admin-command-center-category-intel',
      societyId ?? 'all',
      category ?? 'root',
      subcategoryId ?? 'none',
    ],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_category_intelligence', {
        p_society_id: societyId || null,
        p_category: category || null,
        p_subcategory_id: subcategoryId || null,
      });
      if (error) throw error;
      return (data || {}) as CategoryIntelligenceData;
    },
    staleTime: 30_000,
  });
}
