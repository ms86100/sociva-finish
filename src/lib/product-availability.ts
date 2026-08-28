/**
 * Buyer-facing product availability — distinguishes seller toggle-off from empty stock.
 */

export type ProductAvailabilityState = 'available' | 'unavailable' | 'out_of_stock';

export interface ProductAvailabilityInput {
  is_available?: boolean | null;
  stock_quantity?: number | null;
}

export function resolveProductAvailability(product: ProductAvailabilityInput): {
  state: ProductAvailabilityState;
  canOrder: boolean;
  overlayLabel: string;
} {
  const tracksStock = product.stock_quantity != null;
  const stockEmpty = tracksStock && Number(product.stock_quantity) <= 0;

  if (!product.is_available) {
    return {
      state: 'unavailable',
      canOrder: false,
      overlayLabel: 'Currently not available',
    };
  }

  if (stockEmpty) {
    return {
      state: 'out_of_stock',
      canOrder: false,
      overlayLabel: 'Out of stock',
    };
  }

  return {
    state: 'available',
    canOrder: true,
    overlayLabel: '',
  };
}
