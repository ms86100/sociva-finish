// @ts-nocheck
import { cn } from "@/lib/utils";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Softer brand-tinted shimmer (default). Use muted for dense tables. */
  tone?: 'brand' | 'muted';
};

/**
 * Base shimmer block. Dimensions come from className so layouts stay stable.
 * Never contains fake product names or prices.
 */
function Skeleton({ className, tone = 'brand', ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-2xl relative overflow-hidden",
        tone === 'brand'
          ? "bg-primary/[0.06] dark:bg-primary/[0.12]"
          : "bg-secondary/90",
        className
      )}
      data-skeleton
      aria-hidden
      {...props}
    >
      <div
        className={cn(
          "absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_1.6s_infinite]",
          "bg-gradient-to-r from-transparent via-foreground/[0.07] to-transparent",
          "dark:via-foreground/[0.1]",
          "motion-reduce:translate-x-0 motion-reduce:opacity-40",
        )}
      />
    </div>
  );
}

export { Skeleton };
