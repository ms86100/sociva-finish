import { computeStoreStatus } from '@/lib/store-availability';
import {
  countFoodFacets,
  emptyFoodFacets,
  productMatchesFoodFacets,
  type FoodFacets,
} from '@/lib/food-facets';

export interface TasteBrowseState extends FoodFacets {
  veg: boolean;
  openNow: boolean;
}

export function emptyTasteBrowseState(): TasteBrowseState {
  return { ...emptyFoodFacets(), veg: false, openNow: false };
}

export function hasActiveTasteBrowse(state: TasteBrowseState): boolean {
  return !!(state.veg || state.openNow || countFoodFacets(state));
}

export function productMatchesTasteBrowse(
  product: {
    tags?: string[] | null;
    cuisine_type?: string | null;
    name?: string;
    is_veg?: boolean | null;
    seller_availability_start?: string | null;
    seller_availability_end?: string | null;
    seller_operating_days?: string[] | null;
    seller_is_available?: boolean | null;
  },
  selected: TasteBrowseState,
): boolean {
  if (selected.veg && product.is_veg !== true) return false;
  if (selected.openNow) {
    const status = computeStoreStatus(
      product.seller_availability_start ?? null,
      product.seller_availability_end ?? null,
      product.seller_operating_days ?? null,
      product.seller_is_available ?? true,
    );
    if (status.status !== 'open') return false;
  }
  if (selected.cuisine || selected.meal || selected.course) {
    return productMatchesFoodFacets(product, selected);
  }
  return true;
}
