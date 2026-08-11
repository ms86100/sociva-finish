// @ts-nocheck
import { useState, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { motion, useAnimation } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { hapticImpact, hapticNotification } from '@/lib/haptics';
import { toast } from 'sonner';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { notify } from '@/lib/notify';

interface ProductFavoriteButtonProps {
  productId: string;
  initialFavorite?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  onToggle?: (isFavorite: boolean) => void;
}

export function ProductFavoriteButton({ productId, initialFavorite = false, size = 'sm', className, onToggle }: ProductFavoriteButtonProps) {
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isLoading, setIsLoading] = useState(false);
  const controls = useAnimation();

  const toggle = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      notify.block('Please log in to save products');
      return;
    }
    if (isLoading) return;
    setIsLoading(true);
    hapticImpact('light');

    try {
      if (isFavorite) {
        controls.start({ scale: [1, 0.8, 1], transition: { duration: 0.3 } });
        await supabase.from('product_favorites' as any).delete().eq('user_id', user.id).eq('product_id', productId);
        setIsFavorite(false);
        onToggle?.(false);
      } else {
        controls.start({ scale: [1, 1.3, 0.9, 1.1, 1], transition: { duration: 0.4, ease: 'easeOut' } });
        await supabase.from('product_favorites' as any).insert({ user_id: user.id, product_id: productId } as any);
        setIsFavorite(true);
        onToggle?.(true);
        const { showFeedback } = useFeedbackPopup();
        showFeedback({
          title: 'Saved to favorites',
          variant: 'success'
        });
      }
    } catch {
      hapticNotification('error');
      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Failed to update favorites',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, productId, isFavorite, isLoading, onToggle, controls]);

  const iconSize = size === 'sm' ? 14 : 18;

  return (
    <motion.button
      onClick={toggle}
      disabled={isLoading}
      animate={controls}
      whileTap={{ scale: 0.85 }}
      className={cn(
        'rounded-full flex items-center justify-center transition-colors',
        size === 'sm' ? 'w-7 h-7' : 'w-9 h-9',
        isFavorite ? 'text-destructive' : 'text-muted-foreground hover:text-destructive',
        className
      )}
      aria-label={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
    >
      <Heart size={iconSize} fill={isFavorite ? 'currentColor' : 'none'} strokeWidth={2} />
    </motion.button>
  );
}
