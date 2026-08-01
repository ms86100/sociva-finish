// @ts-nocheck
import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

/**
 * Intercepts `?reorder=<suggestion_id>` query param (set by push notification deep-link)
 * and auto-triggers the quick-reorder flow without introducing extra stateful hooks
 * into the app shell render path.
 */
export function useReorderInterceptor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const processing = useRef(false);
  const suggestionId = searchParams.get('reorder');

  const clearedParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('reorder');
    return next;
  }, [searchParams]);

  useEffect(() => {
    if (!suggestionId || processing.current) return;

    processing.current = true;

    const clearReorderParam = () => {
      setSearchParams(clearedParams, { replace: true });
    };

    void (async () => {
      try {
        const { data: suggestion } = await supabase
          .from('order_suggestions')
          .select('id, product_id, seller_id')
          .eq('id', suggestionId)
          .maybeSingle();

        if (!suggestion) {
          clearReorderParam();
          return;
        }

        const { data: recentOrders } = await supabase
          .from('order_items')
          .select('order_id')
          .eq('product_id', suggestion.product_id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (recentOrders && recentOrders.length > 0) {
          const { data, error } = await supabase.functions.invoke('quick-reorder', {
            body: { order_id: recentOrders[0].order_id },
          });

          if (!error && !data?.error && data?.orders?.[0]) {
            await supabase
              .from('order_suggestions')
              .update({ acted_on: true })
              .eq('id', suggestionId);

            toast({ title: '✅ Order placed!', description: 'Your reorder has been created successfully.' });
            navigate(`/orders/${data.orders[0]}`, { replace: true });
            return;
          }
        }

        navigate(`/product/${suggestion.product_id}`, { replace: true });
      } catch (error) {
        console.error('[useReorderInterceptor] Failed to process reorder:', error);
      } finally {
        clearReorderParam();
        processing.current = false;
      }
    })();
  }, [suggestionId, clearedParams, setSearchParams, navigate]);
}
