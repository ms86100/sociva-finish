import { supabase } from '@/integrations/supabase/client';

type MarketplaceProductRow = {
  id: string;
  stock_quantity: number | null;
  is_available: boolean | null;
  specifications: Record<string, unknown> | null;
  secondary_images: string[] | null;
};

function firstRow(data: unknown): MarketplaceProductRow | null {
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MarketplaceProductRow) || null;
}

export async function fetchMarketplaceProduct(productId: string): Promise<MarketplaceProductRow | null> {
  const { data, error } = await supabase.rpc('get_marketplace_product' as never, {
    _product_id: productId,
  } as never);
  if (error) return null;
  return firstRow(data);
}

export async function fetchMarketplaceStockQuantity(productId: string): Promise<number | null> {
  const { data } = await supabase
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .maybeSingle();
  if (data?.stock_quantity != null) return data.stock_quantity;
  const row = await fetchMarketplaceProduct(productId);
  return row?.stock_quantity ?? null;
}
