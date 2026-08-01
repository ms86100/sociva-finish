// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCart } from '@/hooks/useCart';
import { useSellerTrustSnapshot } from '@/hooks/queries/useProductTrustMetrics';
import { ProductActionType } from '@/types/database';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { useCurrency } from '@/hooks/useCurrency';
import { hapticImpact } from '@/lib/haptics';
import { toast } from 'sonner';

export interface ProductDetail {
  product_id: string;
  product_name: string;
  price: number;
  image_url: string | null;
  is_veg: boolean | null;
  category: string | null;
  description?: string | null;
  prep_time_minutes?: number | null;
  fulfillment_mode?: string | null;
  delivery_note?: string | null;
  action_type?: string | null;
  contact_phone?: string | null;
  specifications?: Record<string, any> | null;
  seller_id: string;
  seller_name: string;
  seller_rating: number;
  seller_reviews: number;
  society_name: string | null;
  distance_km: number | null;
  is_same_society: boolean;
}

export function useProductDetail(product: ProductDetail | null, open: boolean, onOpenChange?: (open: boolean) => void) {
  const { items, addItem, updateQuantity } = useCart();
  const { data: trustSnapshot } = useSellerTrustSnapshot(product?.seller_id || null);
  const [contactOpen, setContactOpen] = useState(false);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<any[]>([]);
  const [loadedSpecs, setLoadedSpecs] = useState<Record<string, any> | null>(null);
  const [canonicalStockQty, setCanonicalStockQty] = useState<number | null>(null);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    if (!product || !open) return;
    setLoadedSpecs(null);
    setCanonicalStockQty(null);

    const fetchData = async () => {
      const [productRes, similarRes] = await Promise.all([
        supabase.from('products').select('specifications, stock_quantity').eq('id', product.product_id).maybeSingle(),
        supabase.from('products')
          .select('id, name, price, image_url, is_veg, seller_id, stock_quantity, seller:seller_profiles!products_seller_id_fkey(business_name, society_id)')
          .eq('category', product.category as string)
          .eq('is_available', true).eq('approval_status', 'approved')
          .neq('id', product.product_id).limit(6),
      ]);
      setLoadedSpecs(productRes.data?.specifications as Record<string, any> | null);
      setCanonicalStockQty(productRes.data?.stock_quantity ?? null);
      setSimilarProducts(similarRes.data || []);
    };
    fetchData();
  }, [product?.product_id, open]);

  const { data: categoryConfigs } = useCategoryConfig();
  const catCfg = categoryConfigs?.find(c => c.category === product?.category);
  const actionType: ProductActionType = deriveActionType(product?.action_type, catCfg?.transactionType ?? null, catCfg ? { supportsCart: catCfg.behavior.supportsCart, enquiryOnly: catCfg.behavior.enquiryOnly } : null);
  const config = ACTION_CONFIG[actionType] || ACTION_CONFIG.add_to_cart;
  const isCartAction = config.isCart;

  const cartItem = items.find((item) => item.product_id === product?.product_id);
  const quantity = cartItem?.quantity || 0;
  const stockLimit = canonicalStockQty ?? 99;
  const canIncrement = quantity < stockLimit;

  const navigate = useNavigate();

  const isStockEmpty = isCartAction && canonicalStockQty != null && canonicalStockQty <= 0;

  const handleAdd = useCallback(() => {
    if (!product) return;
    if (actionType === 'contact_seller') { setContactOpen(true); return; }
    if (!isCartAction) { setEnquiryOpen(true); return; }
    if (canonicalStockQty != null && canonicalStockQty <= 0) { toast.error('This item is currently out of stock'); return; }
    hapticImpact('medium');
    addItem({
      id: product.product_id, seller_id: product.seller_id,
      name: product.product_name, price: product.price,
      image_url: product.image_url, is_veg: product.is_veg ?? true,
      is_available: true, category: product.category as any,
      description: product.description || null,
      is_bestseller: false, is_recommended: false, is_urgent: false,
      created_at: '', updated_at: '',
      stock_quantity: canonicalStockQty,
    } as any);
    onOpenChange?.(false);
    navigate('/cart');
  }, [product, actionType, isCartAction, addItem, onOpenChange, navigate]);

  const isNewSeller = (product?.seller_reviews === 0) || (product?.seller_rating === 0);
  const ActionIcon = config.icon;
  const viewAllLabel = isCartAction ? 'View Full Menu →' : 'View All Listings →';

  return {
    trustSnapshot, contactOpen, setContactOpen, enquiryOpen, setEnquiryOpen,
    showDetails, setShowDetails, reportOpen, setReportOpen, descExpanded, setDescExpanded,
    similarProducts, loadedSpecs, formatPrice,
    actionType, config, isCartAction, cartItem, quantity, stockLimit, canIncrement,
    handleAdd, isNewSeller, ActionIcon, viewAllLabel, isStockEmpty,
    items, updateQuantity,
  };
}
