import { supabase } from '@/integrations/supabase/client';

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export type AdminStoreCreditRow = {
  seller_id: string;
  business_name: string;
  available?: number;
  reserved?: number;
  lifetime_consumed?: number;
  lifetime_purchased?: number;
  lifetime_adjusted?: number;
  last_recharge_at?: string | null;
  seller_phone?: string | null;
};

export async function searchAdminStoreCredits(search: string): Promise<AdminStoreCreditRow[]> {
  const term = search.trim();
  const { data, error } = await adminRpc('admin_list_seller_credits', {
    p_search: term.length > 0 ? term : null,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as AdminStoreCreditRow[]) : [];
}

export function formatAdminStoreOption(row: AdminStoreCreditRow): string {
  const phone = row.seller_phone?.trim();
  return phone ? `${row.business_name} · ${phone}` : row.business_name;
}

export function shortSellerId(id: string): string {
  if (!id) return '';
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}
