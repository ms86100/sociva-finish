// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';

export function ProductCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <motion.div
      key="skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-3 gap-3"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/70 bg-card overflow-hidden">
          <Skeleton className="aspect-[4/5] rounded-none" />
          <div className="p-2.5 space-y-2">
            <Skeleton className="h-4 w-2/3 rounded-lg" />
            <Skeleton className="h-3 w-full rounded-lg" />
            <Skeleton className="h-3 w-4/5 rounded-lg" />
          </div>
        </div>
      ))}
    </motion.div>
  );
}
