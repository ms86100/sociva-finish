// @ts-nocheck
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion, useInView } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';

function useCountUp(target: number, inView: boolean, duration = 1500) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView || target === 0) return;
    let start = 0;
    const step = Math.ceil(target / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setValue(target); clearInterval(timer); }
      else setValue(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, inView, duration]);
  return value;
}

// Hook to fetch estimated counts for landing page stats
function useLandingStats() {
  const societyQuery = useQuery({
    queryKey: ['societyCount'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('societies')
        .select('*', { count: 'estimated', head: true })
        .eq('is_active', true);
      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const sellerQuery = useQuery({
    queryKey: ['sellerCount'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('seller_profiles')
        .select('*', { count: 'estimated', head: true })
        .eq('verification_status', 'approved');
      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  const categoryQuery = useQuery({
    queryKey: ['categoryCount'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('parent_groups')
        .select('*', { count: 'estimated', head: true })
        .eq('is_active', true);
      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    societies: societyQuery.data ?? 0,
    sellers: sellerQuery.data ?? 0,
    categories: categoryQuery.data ?? 0,
    isLoading: societyQuery.isLoading || sellerQuery.isLoading || categoryQuery.isLoading,
    error: societyQuery.error || sellerQuery.error || categoryQuery.error,
  };
}

export function LandingTrustBar() {
  const { societies, sellers, categories, isLoading, error } = useLandingStats();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  const societiesAnim = useCountUp(societies, inView);
  const sellersAnim = useCountUp(sellers, inView);
  const categoriesAnim = useCountUp(categories, inView);

  if (error) {
    console.error('Failed to load landing stats:', error);
    // Optionally show an error state or fallback to defaults
  }

  const items = [
    { label: 'Communities Trust Us', value: societiesAnim },
    { label: 'Neighbor Sellers', value: sellersAnim },
    { label: 'Things You Can\'t Get Elsewhere', value: categoriesAnim },
  ];

  return (
    <section ref={ref} className="py-10 bg-card border-y border-border">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap justify-center gap-10 md:gap-16"
        >
          {items.map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-foreground tabular-nums">
                {value > 0 ? `${value}+` : '—'}
              </p>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}