/**
 * One-shot nearby seller preview after the user confirms a pin on discovery.
 */
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';

export type NearbyPreviewSeller = {
  seller_id: string;
  business_name: string;
  product_count: number;
  distance_km: number;
};

export async function fetchNearbySellersPreview(
  lat: number,
  lng: number,
  radiusKm = MARKETPLACE_RADIUS_KM,
): Promise<NearbyPreviewSeller[]> {
  const { data, error } = await supabase.rpc('search_sellers_paginated' as any, {
    _lat: lat,
    _lng: lng,
    _radius_km: radiusKm,
    _limit: 6,
    _offset: 0,
  });

  if (error) {
    console.warn('[discovery-nearby]', error.message);
    return [];
  }

  return ((data || []) as any[]).map((row) => ({
    seller_id: row.seller_id,
    business_name: row.business_name || 'Store',
    product_count: Number(row.product_count) || 0,
    distance_km: Number(row.distance_km) || 0,
  }));
}
