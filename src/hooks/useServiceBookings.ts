// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ServiceBooking {
  id: string;
  order_id: string;
  slot_id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  location_type: string;
  buyer_address: string | null;
  status: string;
  staff_id: string | null;
  rescheduled_from: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  buyer_name?: string;
  product_name?: string;
  staff_name?: string;
}

export function useSellerServiceBookings(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-service-bookings', sellerId],
    queryFn: async (): Promise<ServiceBooking[]> => {
      if (!sellerId) return [];
      const { data, error } = await supabase
        .from('service_bookings')
        .select('id, order_id, slot_id, buyer_id, seller_id, product_id, booking_date, start_time, end_time, location_type, buyer_address, status, staff_id, rescheduled_from, cancelled_at, cancellation_reason, created_at, updated_at, product:products!service_bookings_product_id_fkey(name), staff:service_staff(name)')
        .eq('seller_id', sellerId)
        .not('status', 'in', '(cancelled,no_show)')
        .gte('booking_date', new Date().toISOString().split('T')[0])
        .lte('booking_date', new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('booking_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row,
        buyer_name: row.buyer?.name || null,
        product_name: row.product?.name || null,
        staff_name: row.staff?.name || null,
      })) as ServiceBooking[];
    },
    enabled: !!sellerId,
    staleTime: 2 * 60_000,
  });
}

export function useServiceBookingForOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ['service-booking-order', orderId],
    queryFn: async (): Promise<ServiceBooking | null> => {
      if (!orderId) return null;
      const { data, error } = await supabase
        .from('service_bookings')
        .select('*, staff:service_staff(name)')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...data, staff_name: (data as any).staff?.name || null } as ServiceBooking;
    },
    enabled: !!orderId,
  });
}

export function useBookingAddons(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['booking-addons', bookingId],
    queryFn: async () => {
      if (!bookingId) return [];
      const { data, error } = await supabase
        .from('service_booking_addons')
        .select('*, addon:service_addons(name, description)')
        .eq('booking_id', bookingId);
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        name: row.addon?.name || row.addon_name || 'Add-on',
        description: row.addon?.description || null,
        price: row.addon_price ?? 0,
      }));
    },
    enabled: !!bookingId,
  });
}

export interface BuyerBooking extends ServiceBooking {
  product_name?: string;
  seller_name?: string;
  seller_cover_image?: string;
}

export function useBuyerServiceBookings(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer-service-bookings', buyerId],
    queryFn: async (): Promise<BuyerBooking[]> => {
      if (!buyerId) return [];
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('service_bookings')
        .select('*, product:products!service_bookings_product_id_fkey(name), seller:seller_profiles!service_bookings_seller_id_fkey(business_name, cover_image_url), staff:service_staff(name)')
        .eq('buyer_id', buyerId)
        .not('status', 'in', '(cancelled,no_show)')
        .gte('booking_date', today)
        .order('booking_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row,
        product_name: row.product?.name || null,
        seller_name: row.seller?.business_name || null,
        seller_cover_image: row.seller?.cover_image_url || null,
        staff_name: row.staff?.name || null,
      })) as BuyerBooking[];
    },
    enabled: !!buyerId,
  });
}

export function useSessionFeedback(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['session-feedback', bookingId],
    queryFn: async () => {
      if (!bookingId) return null;
      const { data, error } = await supabase
        .from('session_feedback')
        .select('*')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!bookingId,
  });
}

export function useBuyerRecurringConfigs(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer-recurring-configs', buyerId],
    queryFn: async () => {
      if (!buyerId) return [];
      try {
        // Step 1: fetch configs without join (no FK to products exists)
        const { data: configs, error } = await supabase
          .from('service_recurring_configs')
          .select('*')
          .eq('buyer_id', buyerId)
          .eq('is_active', true)
          .order('created_at', { ascending: false });
        if (error) {
          console.warn('[RecurringConfigs] Query failed:', error.message);
          return [];
        }
        if (!configs || configs.length === 0) return [];

        // Step 2: hydrate product names separately
        const productIds = [...new Set(configs.map((c: any) => c.product_id).filter(Boolean))];
        let productMap = new Map<string, string>();
        if (productIds.length > 0) {
          const { data: products } = await supabase
            .from('products')
            .select('id, name')
            .in('id', productIds);
          (products || []).forEach((p: any) => productMap.set(p.id, p.name));
        }

        return configs.map((row: any) => ({
          ...row,
          product_name: productMap.get(row.product_id) || 'Service',
        }));
      } catch (err) {
        console.error('[RecurringConfigs] Unexpected error:', err);
        return [];
      }
    },
    enabled: !!buyerId,
  });
}
