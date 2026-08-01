// @ts-nocheck
import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { notify } from '@/lib/notify';

interface NotifyMeButtonProps {
  productId: string;
  className?: string;
  compact?: boolean;
}

export function NotifyMeButton({ productId, className, compact = true }: NotifyMeButtonProps) {
  const { user } = useAuth();
  const [isWatching, setIsWatching] = useState(false);
  const [loading, setLoading] = useState(false);
  const ml = useMarketplaceLabels();

  const handleNotifyMe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) {
      notify.block('Please log in to get notifications');
      return;
    }
    setLoading(true);
    try {
      if (isWatching) {
        await supabase
          .from('stock_watchlist')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', productId);
        setIsWatching(false);
        toast.success('Removed from watchlist');
      } else {
        const { error } = await supabase
          .from('stock_watchlist')
          .upsert({ user_id: user.id, product_id: productId }, { onConflict: 'user_id,product_id' });
        if (error) throw error;
        setIsWatching(true);
        toast.success("We'll notify you when it's back!");
      }
    } catch (err) {
      console.error(err);
      toast.error('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <div className="px-2.5 pb-2.5">
        <button
          onClick={handleNotifyMe}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-1 text-[10px] font-semibold py-1.5 rounded-lg transition-colors ${
            isWatching
              ? 'bg-primary/10 text-primary border border-primary/30'
              : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary'
          } ${className || ''}`}
        >
          {isWatching ? <BellOff size={10} /> : <Bell size={10} />}
          {isWatching ? ml.label('label_notify_watching') : ml.label('label_notify_me')}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleNotifyMe}
      disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isWatching
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary'
      } ${className || ''}`}
    >
      {isWatching ? <BellOff size={14} /> : <Bell size={14} />}
      {isWatching ? ml.label('label_notify_watching_long') : ml.label('label_notify_me_long')}
    </button>
  );
}
