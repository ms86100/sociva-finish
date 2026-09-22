// @ts-nocheck
import { motion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import { discoveryPulse, slideUp, staggerContainer, cardEntrance } from '@/lib/motion-variants';
import type { NearbyPreviewSeller } from '@/lib/discovery-nearby';
import { displaySellerStoreName } from '@/lib/seller-journey';

type Props = {
  sellers?: NearbyPreviewSeller[];
  phase: 'searching' | 'found';
};

export function DiscoveryFindingPanel({ sellers = [], phase }: Props) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 py-12 safe-top">
      <div className="relative mb-8">
        <motion.div
          className="absolute inset-0 -m-4 rounded-full bg-primary/20"
          variants={discoveryPulse}
          animate="animate"
        />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <MapPin size={28} strokeWidth={2.25} />
        </div>
      </div>

      {phase === 'searching' ? (
        <div className="text-center space-y-3">
          <h2 className="text-xl font-bold text-foreground">Finding what&apos;s around you…</h2>
          <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary"
                animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          className="w-full max-w-sm space-y-4"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.p
            className="text-center text-sm font-medium text-muted-foreground"
            variants={slideUp}
          >
            Nearby on Sociva
          </motion.p>
          {sellers.slice(0, 3).map((s) => (
            <motion.div
              key={s.seller_id}
              variants={cardEntrance}
              className="rounded-xl border border-border/60 bg-card/80 px-4 py-3"
            >
              <p className="font-semibold text-foreground">
                {displaySellerStoreName(s.business_name)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {s.distance_km > 0 ? `${s.distance_km.toFixed(1)} km · ` : ''}
                {s.product_count} listing{s.product_count === 1 ? '' : 's'}
              </p>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
