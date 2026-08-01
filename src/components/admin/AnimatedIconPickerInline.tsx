// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { AnimatedCategoryIcon, ANIMATED_ICON_REGISTRY, ANIMATED_ICON_KEYS, isAnimatedIcon } from '@/components/icons/AnimatedCategoryIcons';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Inline picker that shows current icon and opens a grid to select animated icons.
 * Falls back to emoji text input.
 */
export function AnimatedIconPickerInline({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isAnim = isAnimatedIcon(value);

  // Group icons by category
  const grouped = ANIMATED_ICON_KEYS.reduce((acc, key) => {
    const entry = ANIMATED_ICON_REGISTRY[key];
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(key);
    return acc;
  }, {} as Record<string, string[]>);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-12 h-9 rounded-lg border border-border flex items-center justify-center',
          'hover:border-primary/50 transition-colors bg-background',
          open && 'border-primary ring-1 ring-primary/30',
        )}
      >
        {isAnim ? (
          <AnimatedCategoryIcon iconKey={value} size={24} color="hsl(var(--primary))" />
        ) : (
          <span className="text-lg">{value || '📦'}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-10 left-0 z-50 w-[320px] max-h-[340px] overflow-y-auto rounded-xl border border-border bg-popover shadow-xl p-3 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Animated Icons</p>
          {Object.entries(grouped).map(([cat, keys]) => (
            <div key={cat}>
              <p className="text-[9px] font-semibold text-muted-foreground mb-1.5">{cat}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {keys.map(key => {
                  const entry = ANIMATED_ICON_REGISTRY[key];
                  const selected = value === `anim:${key}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { onChange(`anim:${key}`); setOpen(false); }}
                      className={cn(
                        'flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-all',
                        selected
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-transparent hover:bg-accent/50 hover:border-border',
                      )}
                      title={entry.label}
                    >
                      <AnimatedCategoryIcon iconKey={key} size={24} color={selected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'} />
                      <span className="text-[8px] font-medium text-muted-foreground leading-tight">{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-border">
            <p className="text-[9px] font-semibold text-muted-foreground mb-1">Or use an emoji</p>
            <input
              type="text"
              value={isAnim ? '' : value}
              onChange={e => { onChange(e.target.value); if (e.target.value) setOpen(false); }}
              className="w-full h-8 text-center text-lg rounded-lg border border-border bg-background px-2"
              placeholder="📦 Type emoji..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
