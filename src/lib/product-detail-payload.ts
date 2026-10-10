import type { ProductWithSeller } from '@/components/product/ProductListingCard';

interface CategoryDisplaySource {
  category: string;
  icon?: string | null;
  displayName?: string | null;
}

function categoryDisplay(category: string, categoryConfigs: CategoryDisplaySource[]) {
  const catConfig = categoryConfigs.find((c) => c.category === category);
  return {
    _catIcon: catConfig?.icon || '🛍️',
    _catName: catConfig?.displayName || category,
  };
}

/** ProductDetailSheet payload for a tapped marketplace listing card. */
export function buildProductDetailPayload(
  product: ProductWithSeller,
  categoryConfigs: CategoryDisplaySource[],
) {
  return {
    product_id: product.id,
    product_name: product.name,
    price: product.price,
    image_url: product.image_url,
    is_veg: product.is_veg,
    category: product.category,
    description: product.description,
    prep_time_minutes: product.prep_time_minutes,
    fulfillment_mode: product.fulfillment_mode,
    seller_fulfillment_mode: product.seller_fulfillment_mode || product.fulfillment_mode,
    home_service_available: product.home_service_available ?? null,
    seller_home_service_available: product.seller_home_service_available === true,
    home_service_fee: product.home_service_fee ?? null,
    delivery_note: product.delivery_note,
    action_type: product.action_type,
    contact_phone: product.contact_phone,
    specifications: product.specifications || null,
    seller_id: product.seller_id,
    seller_name: product.seller_name || '',
    seller_rating: product.seller_rating || 0,
    seller_reviews: product.seller_reviews || 0,
    seller_verified: !!(product as any).seller_verified,
    society_name: (product as any).society_name || null,
    distance_km: (product as any).distance_km ?? null,
    is_same_society: (product as any).is_same_society ?? true,
    delivery_time_text: (product as any).delivery_time_text || null,
    last_active_at: (product as any).last_active_at ?? null,
    ...categoryDisplay(product.category, categoryConfigs),
  };
}

/** ProductDetailSheet payload when switching to a related product inside the sheet. */
export function buildRelatedProductDetailPayload(
  sp: any,
  categoryConfigs: CategoryDisplaySource[],
) {
  return {
    product_id: sp.id,
    product_name: sp.name,
    price: sp.price,
    image_url: sp.image_url,
    is_veg: sp.is_veg,
    category: sp.category,
    description: sp.description || null,
    seller_id: sp.seller_id,
    seller_name: sp.seller?.business_name || '',
    seller_rating: 0,
    seller_reviews: 0,
    action_type: sp.action_type,
    ...categoryDisplay(sp.category, categoryConfigs),
  };
}
