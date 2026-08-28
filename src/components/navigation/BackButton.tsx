// @ts-nocheck
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSmartBack } from '@/hooks/useSmartBack';

type BackButtonProps = {
  fallback?: string;
  onClick?: () => void;
  className?: string;
  iconSize?: number;
  'aria-label'?: string;
};

/**
 * Consistent circular back control used across headers.
 */
export function BackButton({
  fallback,
  onClick,
  className,
  iconSize = 18,
  'aria-label': ariaLabel = 'Go back',
}: BackButtonProps) {
  const goBack = useSmartBack(fallback);

  return (
    <button
      type="button"
      onClick={onClick || (() => goBack({ fallback }))}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0',
        'active:scale-95 transition-transform',
        className,
      )}
    >
      <ArrowLeft size={iconSize} />
    </button>
  );
}
