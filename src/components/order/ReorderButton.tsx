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

interface ReorderButtonProps {
  orderItems: OrderItem[];
  sellerId: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function ReorderButton({ 
  orderItems, 
  sellerId, 
  variant = 'default',
  size = 'sm',
  className 
}: ReorderButtonProps) {
  const { user } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const navigate = useNavigate();
  const { replaceCart } = useCart();
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
      const productIds = orderItems
        .filter(item => item.product_id)
        .map(item => item.product_id);

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

      // Warn buyer if any prices changed since original order
      const priceChanged = discoverableProducts.some(p => {
        const original = orderItems.find(oi => oi.product_id === p.id);
        return original?.unit_price != null && p.price !== original.unit_price;
      });
      if (priceChanged) {
        toast.info('Heads up: Some prices may have changed since your last order');
      }

      const cartInserts = orderItems
        .filter(item => 
          item.product_id && 
          discoverableProducts.some(p => p.id === item.product_id)
        )
        .map(item => ({
          product_id: item.product_id!,
          quantity: item.quantity,
        }));

      if (cartInserts.length === 0) {
        notify.block('None of the items from this order are currently available.', { id: 'reorder-unavailable', title: 'Items unavailable' });
        setIsLoading(false);
        return;
      }

      // Use the cart provider's replaceCart — seeds cache before navigation
      await replaceCart(cartInserts);

      const unavailableCount = orderItems.length - cartInserts.length;
      if (unavailableCount > 0) {
        toast.info(`${unavailableCount} item(s) were unavailable and skipped`);
      }

      navigate('/cart');
    } catch (error) {
      console.error('Error reordering:', error);
      toast.error('Failed to reorder. Please try again.');
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
