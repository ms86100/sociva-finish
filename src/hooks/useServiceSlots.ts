// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, startOfToday } from 'date-fns';

export interface ServiceSlot {
  id: string;
  product_id: string | null;
  seller_id: string;
  slot_date: string;
  day_of_week?: number | null;
  start_time: string;
  end_time: string;
  max_capacity: number;
  booked_count: number;
  is_blocked: boolean;
}

/**
 * Fetches store-wide booking slots for the seller that owns this product.
 * Slots are unified across the entire store (product_id IS NULL) — booking
 * any service at 10:00 makes 10:00 unavailable for every other service in
 * the same store.
 */
export function useServiceSlots(productId: string | undefined, daysAhead = 30) {
  const today = startOfToday();
  const endDate = addDays(today, daysAhead);

  return useQuery({
    queryKey: ['service-slots-store', productId, daysAhead],
    queryFn: async (): Promise<ServiceSlot[]> => {
      if (!productId) return [];

      // Resolve the seller from the product, and ensure the product is approved
      const { data: product } = await supabase
        .from('products')
        .select('seller_id, approval_status')
        .eq('id', productId)
        .maybeSingle();

      if (!product || product.approval_status !== 'approved' || !product.seller_id) {
        return [];
      }

      const { data, error } = await supabase
        .from('service_slots')
        .select('*')
        .eq('seller_id', product.seller_id)
        .is('product_id', null)
        .eq('is_blocked', false)
        .gte('slot_date', format(today, 'yyyy-MM-dd'))
        .lte('slot_date', format(endDate, 'yyyy-MM-dd'))
        .order('slot_date')
        .order('start_time');

      if (error) throw error;

      return (data || []).filter(
        (slot: any) => slot.booked_count < slot.max_capacity
      ) as ServiceSlot[];
    },
    enabled: !!productId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Normalize Postgres time / picker values to HH:mm for stable matching. */
export function normalizeSlotTime(time: string | null | undefined): string {
  if (!time) return '';
  const trimmed = String(time).trim();
  // Already HH:mm or HH:mm:ss
  const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return trimmed;
}

export function slotsToPickerFormat(slots: ServiceSlot[]): { date: string; slots: string[] }[] {
  const grouped: Record<string, string[]> = {};
  for (const slot of slots) {
    if (!grouped[slot.slot_date]) grouped[slot.slot_date] = [];
    const timeStr = normalizeSlotTime(slot.start_time);
    if (timeStr && !grouped[slot.slot_date].includes(timeStr)) {
      grouped[slot.slot_date].push(timeStr);
    }
  }
  return Object.entries(grouped).map(([date, times]) => ({
    date,
    slots: times.sort(),
  }));
}

export function findSlot(slots: ServiceSlot[], date: string, time: string): ServiceSlot | undefined {
  const want = normalizeSlotTime(time);
  return slots.find(
    (s) => s.slot_date === date && normalizeSlotTime(s.start_time) === want,
  );
}
