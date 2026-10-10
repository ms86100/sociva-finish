// @ts-nocheck
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSmartBack } from '@/hooks/useSmartBack';
import { handleInAppBackLayers } from '@/lib/navigation-stack';

type BackButtonProps = {
  fallback?: string;
  onClick?: () => void;
  className?: string;
  iconSize?: number;
  'aria-label'?: string;
};

/**
 * Consistent circular back control used across headers.
 * Closes the same overlays and wizard steps as hardware Back before leaving.
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
      onClick={onClick || (() => {
        if (handleInAppBackLayers()) return;
        goBack({ fallback });
      })}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center justify-center w-11 h-11 rounded-full bg-muted shrink-0',
        'active:scale-95 transition-transform',
        className,
      )}
    >
      <ArrowLeft size={iconSize} />
    </button>
  );
}
