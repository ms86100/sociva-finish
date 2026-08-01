// @ts-nocheck
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion, useInView } from 'framer-motion';

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

export function LandingTrustBar() {
  const [stats, setStats] = useState({ societies: 0, sellers: 0, categories: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  const societies = useCountUp(stats.societies, inView);
  const sellers = useCountUp(stats.sellers, inView);
  const categories = useCountUp(stats.categories, inView);

  useEffect(() => {
    async function load() {
      const [s, sel, cat] = await Promise.all([
        supabase.from('societies').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('seller_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'approved'),
        supabase.from('parent_groups').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ]);
      setStats({ societies: s.count || 0, sellers: sel.count || 0, categories: cat.count || 0 });
    }
    load();
  }, []);

  const items = [
    { label: 'Communities Trust Us', value: societies },
    { label: 'Neighbor Sellers', value: sellers },
    { label: 'Things You Can\'t Get Elsewhere', value: categories },
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
