import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import type { DiscoveryIntent } from '@/lib/discovery-intents';

interface DiscoveryChipRailProps {
  intents: DiscoveryIntent[];
  className?: string;
  /** Home uses this as the filter bar, so the "Nearby now" label stays off. */
  showTitle?: boolean;
  selectedIds?: string[];
  onSelect?: (intent: DiscoveryIntent) => void;
}

export function DiscoveryChipRail({
  intents,
  className,
  showTitle = true,
  selectedIds = [],
  onSelect,
}: DiscoveryChipRailProps) {
  const navigate = useNavigate();
  if (intents.length === 0) return null;

  return (
    <div className={cn('px-4 py-2', className)}>
      {showTitle && (
        <p className="mb-2 text-[13px] font-extrabold tracking-tight text-foreground">
          Nearby now
        </p>
      )}
      <div className="taste-rail-scroll scrollbar-hide">
        <div className="flex w-max items-start gap-3 pr-3">
          {intents.map((intent) => {
            const selected = selectedIds.includes(intent.id);
            return (
            <button
              key={intent.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                hapticSelection();
                if (onSelect) onSelect(intent);
                else navigate(intent.href);
              }}
              className="flex w-16 shrink-0 flex-col items-center gap-1.5 active:scale-95"
            >
              <span
                className={cn(
                  'relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full',
                  'border border-white/50 bg-background/70 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)] backdrop-blur-md',
                  'ring-1 ring-white/40',
                  intent.kind === 'food_mood' && 'bg-gradient-to-br from-amber-100/80 to-orange-50/70',
                  selected && 'ring-2 ring-primary',
                )}
              >
                {intent.imageUrl ? (
                  <img
                    src={optimizedImageUrl(intent.imageUrl, { width: 120, quality: 70 })}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={handleImageError}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-foreground">
                    <DynamicIcon name={intent.icon} size={22} />
                  </span>
                )}
              </span>
              <span className={cn(
                'line-clamp-2 text-center text-[10px] font-semibold leading-tight',
                selected ? 'text-primary' : 'text-foreground',
              )}>
                {intent.label}
              </span>
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
