import { ResolvedProduct } from '@/lib/bannerProductResolver';
import { ProductWithSeller } from '@/components/product/ProductListingCard';

export function toProductWithSeller(p: ResolvedProduct): ProductWithSeller {
  const now = new Date().toISOString();
  return {
    id: p.id,
    seller_id: p.seller_id,
    name: p.name,
    price: Number(p.price) || 0,
    image_url: p.image_url,
    category: p.category || '',
    is_veg: !!p.is_veg,
    is_available: p.is_available,
    is_bestseller: !!p.is_bestseller,
    is_recommended: false,
    is_urgent: false,
    description: null,
    mrp: p.mrp,
    stock_quantity: p.stock_quantity,
    delivery_time_text: p.delivery_time_text || null,
    discount_percentage: p.discount_percentage ?? null,
    seller_name: p.seller_name || undefined,
    seller_rating: p.seller_rating != null ? Number(p.seller_rating) : undefined,
    seller_reviews: p.seller_reviews ?? undefined,
    seller_verified: !!p.seller_verified,
    created_at: now,
    updated_at: now,
  };
}
