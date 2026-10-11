// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/hooks/useCart';
import { OrderItem } from '@/types/Database';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { notify } from '@/lib/notify';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { buyerCanOrderFromSeller, filterDiscoverableProductIds } from '@/lib/sellerDiscoverability';
import { PRECISE_LOCATION_TITLE } from '@/lib/buyerLocation';
import { getClosedStoreReorderMessage, resolveReorderLines } from '@/lib/reorder';
import { parseStoreClosedBuyerError } from '@/lib/store-availability';
import { useLoadVariantProductIds } from '@/hooks/useProductVariants';
import { fetchVariantsByIds } from '@/lib/product-variants';

interface ReorderButtonProps {
  orderItems: OrderItem[];
  sellerId: string;
  orderId?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function ReorderButton({ 
  orderItems, 
  sellerId,
  orderId,
  variant = 'default',
  size = 'sm',
  className 
}: ReorderButtonProps) {
  const { user } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const navigate = useNavigate();
  const { replaceCart } = useCart();
  const loadVariantProductIds = useLoadVariantProductIds();
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleReorder = async (e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!user) {
      notify.block('Please log in to reorder');
      return;
    }

    if (orderItems.length === 0) {
      notify.block('This order has no reusable items.', { id: 'reorder-empty', title: 'Nothing to reorder' });
      return;
    }

    // Check for existing cart
    const { data: existingCart } = await supabase
      .from('cart_items')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (existingCart && existingCart.length > 0) {
      setShowConfirm(true);
      return;
    }

    await executeReorder();
  };

  const executeReorder = async () => {
    if (!user) return;
    setShowConfirm(false);
    setIsLoading(true);
    try {
      const lines = await resolveReorderLines(orderItems, orderId, await loadVariantProductIds());
      const productIds = lines.map((item) => item.product_id);

      if (productIds.length === 0) {
        notify.block('This order has no reusable items.', { id: 'reorder-empty', title: 'Nothing to reorder' });
        setIsLoading(false);
        return;
      }

      // Check product availability and approval status
      const { data: availableProducts } = await supabase
        .from('products')
        .select('id, price, seller_id')
        .in('id', productIds)
        .eq('is_available', true)
        .eq('approval_status', 'approved');

      if (!availableProducts || availableProducts.length === 0) {
        notify.block('None of the items from this order are currently available.', { id: 'reorder-unavailable', title: 'Items unavailable' });
        setIsLoading(false);
        return;
      }

      const gate = await buyerCanOrderFromSeller(sellerId, browsingLocation?.lat, browsingLocation?.lng);
      if (!gate.ok) {
        notify.block(gate.reason === 'buyer_location' ? PRECISE_LOCATION_TITLE : gate.message, { id: 'reorder-unavailable', title: 'Unavailable' });
        setIsLoading(false);
        return;
      }
      const allowed = await filterDiscoverableProductIds(
        availableProducts.map((p) => p.id),
        browsingLocation?.lat,
        browsingLocation?.lng,
      );
      const discoverableProducts = availableProducts.filter((p) => allowed.has(p.id));
      if (discoverableProducts.length === 0) {
        notify.block('None of the items from this order are currently available in your area.', { id: 'reorder-unavailable', title: 'Items unavailable' });
        setIsLoading(false);
        return;
      }

      const closedMessage = await getClosedStoreReorderMessage([
        sellerId,
        ...discoverableProducts.map((p) => p.seller_id).filter(Boolean),
      ]);
      if (closedMessage) {
        notify.block(closedMessage, { id: 'reorder-store-closed', title: 'Store closed' });
        setIsLoading(false);
        return;
      }

      // Warn buyer if any prices changed since original order
      const sizedLines = lines.filter((l) => l.variant_id);
      const sizedProductSet = new Set(sizedLines.map((l) => l.product_id));
      const variantsById = sizedLines.length > 0
        ? await fetchVariantsByIds(sizedLines.map((l) => l.variant_id as string))
        : new Map();
      const priceChanged = discoverableProducts.some(p => {
        if (sizedProductSet.has(p.id)) return false;
        const original = orderItems.find(oi => oi.product_id === p.id) || lines.find(oi => oi.product_id === p.id);
        return original && 'unit_price' in (original as any) && (original as any).unit_price != null && p.price !== (original as any).unit_price;
      }) || sizedLines.some((l) => {
        const current = variantsById.get(l.variant_id as string)?.price;
        return l.unit_price != null && current != null && current !== l.unit_price;
      });
      if (priceChanged) {
        toast.info('Heads up: Some prices may have changed since your last order');
      }

      const availableSet = new Set(discoverableProducts.map((p) => p.id));
      const cartInserts = lines
        .filter((item) => availableSet.has(item.product_id))
        .map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          ...(item.variant_id ? { variant_id: item.variant_id } : {}),
        }));

      if (cartInserts.length === 0) {
        notify.block('None of the items from this order are currently available.', { id: 'reorder-unavailable', title: 'Items unavailable' });
        setIsLoading(false);
        return;
      }

      // Use the cart provider's replaceCart - seeds cache before navigation
      await replaceCart(cartInserts);

      const unavailableCount = lines.length - cartInserts.length;
      if (unavailableCount > 0) {
        toast.info(`${unavailableCount} item(s) were unavailable and skipped`);
      }

      navigate('/cart');
    } catch (error) {
      console.error('Error reordering:', error);
      const closed = parseStoreClosedBuyerError(error);
      if (closed) {
        notify.block(closed, { id: 'reorder-store-closed', title: 'Store closed' });
      } else {
        toast.error('Failed to reorder. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleReorder}
        disabled={isLoading}
        className={cn(
          'rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 font-semibold text-xs',
          className
        )}
      >
        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        {size !== 'icon' && (
          <span className="ml-1.5">{isLoading ? 'Adding...' : 'Reorder'}</span>
        )}
      </Button>
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace cart?</AlertDialogTitle>
            <AlertDialogDescription>Your current cart will be cleared and replaced with items from this order.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeReorder}>Replace Cart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
