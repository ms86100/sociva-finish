import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SellerLocationLineProps {
  text: string | null | undefined;
  className?: string;
  textClassName?: string;
  iconSize?: number;
  clamp?: 0 | 2;
  mapsUrl?: string | null;
}

export function SellerLocationLine({
  text,
  className,
  textClassName,
  iconSize = 10,
  clamp = 0,
  mapsUrl,
}: SellerLocationLineProps) {
  const label = (text || '').trim();
  if (!label) return null;

  const inner = (
    <>
      <MapPin size={iconSize} className="shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <span
        className={cn(
          'min-w-0 text-[10px] font-medium text-muted-foreground leading-snug whitespace-normal break-words',
          clamp === 2 && 'line-clamp-2',
          textClassName,
        )}
      >
        {label}
      </span>
    </>
  );

  if (mapsUrl) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(mapsUrl, '_blank');
        }}
        className={cn('flex items-start gap-1 min-w-0 text-left', className)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={cn('flex items-start gap-1 min-w-0', className)}>
      {inner}
    </div>
  );
}
