// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { notify } from '@/lib/notify';
import { friendlyError } from '@/lib/utils';

interface Props {
  sellerId: string;
  sellerUserId?: string;
}

export function SellerRecommendButton({ sellerId, sellerUserId }: Props) {
  const { user, effectiveSocietyId } = useAuth();
  const [recommended, setRecommended] = useState(false);
  const [count, setCount] = useState(0);
  const [recommenders, setRecommenders] = useState<{ name: string; block?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchRecommendations();
  }, [sellerId, user]);

  const fetchRecommendations = async () => {
    const { data } = await supabase.rpc('get_seller_recommendations', { _seller_id: sellerId });
    if (data && data.length > 0) {
      setCount(Number(data[0].total_count) || 0);
      const recs = data[0].recommenders;
      setRecommenders(Array.isArray(recs) ? (recs as { name: string; block?: string }[]) : []);
    }
    if (user) {
      const { data: mine } = await supabase
        .from('seller_recommendations')
        .select('id')
        .eq('seller_id', sellerId)
        .eq('recommender_id', user.id)
        .maybeSingle();
      setRecommended(!!mine);
    }
  };

  const handleToggle = async () => {
    if (!user) {
      notify.block('Please sign in to recommend');
      return;
    }
    if (user.id === sellerUserId) {
      notify.block("You can't recommend yourself");
      return;
    }
    setLoading(true);
    try {
      if (recommended) {
        const { error } = await supabase
          .from('seller_recommendations')
          .delete()
          .eq('seller_id', sellerId)
          .eq('recommender_id', user.id);
        if (error) throw error;
        setRecommended(false);
        setCount((c) => Math.max(0, c - 1));
        toast.success('Recommendation removed');
      } else {
        const { error } = await supabase.from('seller_recommendations').insert({
          seller_id: sellerId,
          recommender_id: user.id,
          society_id: effectiveSocietyId || null,
        });
        if (error) throw error;
        setRecommended(true);
        setCount((c) => c + 1);
        toast.success('Thanks for recommending!');
      }
    } catch (err: any) {
      toast.error(friendlyError(err) || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        variant={recommended ? 'default' : 'outline'}
        size="sm"
        className="text-xs gap-1.5"
        onClick={handleToggle}
        disabled={loading}
      >
        <ThumbsUp size={13} className={recommended ? 'fill-current' : ''} />
        {recommended ? 'Recommended' : 'Recommend'}
        {count > 0 && <span className="ml-0.5 font-bold">{count}</span>}
      </Button>
      {recommenders.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Recommended by {recommenders.slice(0, 3).map((r) => r.name).join(', ')}
          {count > 3 && ` +${count - 3} more`}
        </p>
      )}
    </div>
  );
}
