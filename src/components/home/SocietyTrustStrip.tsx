// @ts-nocheck
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shield, Users, Store, Verified } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';

export function SocietyTrustStrip() {
  const { effectiveSociety, effectiveSocietyId, isApproved } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['society-trust-strip', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return null;

      const [{ count: sellerCount }, { data: society }] = await Promise.all([
        supabase
          .from('seller_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('society_id', effectiveSocietyId)
          .eq('verification_status', 'approved'),
        supabase
          .from('societies')
          .select('member_count, is_verified')
          .eq('id', effectiveSocietyId)
          .maybeSingle(),
      ]);

      return {
        families: society?.member_count || 0,
        sellers: sellerCount || 0,
        isVerified: society?.is_verified || false,
      };
    },
    enabled: !!isApproved && !!effectiveSocietyId,
    staleTime: 5 * 60_000,
  });

  if (!effectiveSociety || !isApproved || !effectiveSocietyId) return null;

  if (isLoading) {
    return (
      <div className="mx-4 mt-3">
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    );
  }

  if (!stats || (stats.families === 0 && stats.sellers === 0)) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mx-4 mt-3">
      <div className="relative overflow-hidden rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
        <div className="flex items-center gap-2.5">
          {stats.isVerified && (
            <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Shield size={16} className="text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-foreground truncate">{effectiveSociety.name}</span>
              {stats.isVerified && <Verified size={14} className="text-primary shrink-0" />}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users size={11} className="shrink-0 text-primary/70" />
                <span className="font-semibold">{stats.families}</span> families
              </span>
              <span className="w-1 h-1 rounded-full bg-border" />
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Store size={11} className="shrink-0 text-primary/70" />
                <span className="font-semibold">{stats.sellers}</span> sellers
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
