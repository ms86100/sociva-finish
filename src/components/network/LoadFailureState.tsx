import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type LoadFailureVariant = 'error' | 'offline' | 'slow';

const DEFAULT_COPY: Record<LoadFailureVariant, { title: string; description: string }> = {
  error: {
    title: "Couldn't load this right now",
    description: 'Check your internet connection and try again.',
  },
  offline: {
    title: "You're offline",
    description: 'This will refresh automatically when your connection is back.',
  },
  slow: {
    title: 'Taking longer than usual',
    description: 'Your connection seems slow. You can keep waiting or try again.',
  },
};

interface LoadFailureStateProps {
  variant: LoadFailureVariant;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Extra actions rendered under Retry, e.g. a link to another screen. */
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Shared "could not load" / "offline" / "slow" card with a Retry action.
 * Never used for genuine empty results - those keep their own copy.
 */
export function LoadFailureState({
  variant,
  title,
  description,
  onRetry,
  retrying = false,
  children,
  className,
  compact = false,
}: LoadFailureStateProps) {
  const copy = DEFAULT_COPY[variant];
  const Icon = variant === 'offline' ? WifiOff : variant === 'slow' ? Loader2 : AlertTriangle;

  return (
    <div
      role={variant === 'slow' ? 'status' : 'alert'}
      data-testid={`load-failure-${variant}`}
      className={cn(
        'rounded-2xl border border-border bg-card text-center',
        compact ? 'px-4 py-4' : 'px-5 py-8',
        className,
      )}
    >
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Icon size={18} className={cn('text-muted-foreground', variant === 'slow' && 'animate-spin')} />
      </div>
      <p className="text-sm font-semibold text-foreground">{title ?? copy.title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{description ?? copy.description}</p>
      {(onRetry || children) && (
        <div className="mx-auto mt-4 flex max-w-xs flex-col gap-2">
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              <RefreshCw size={14} className={cn('mr-1.5', retrying && 'animate-spin')} />
              {retrying ? 'Retrying...' : 'Retry'}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
