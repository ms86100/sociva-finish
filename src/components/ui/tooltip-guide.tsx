// @ts-nocheck
import { useState, useEffect } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TooltipGuideProps {
  id: string; // Unique identifier for localStorage
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  children: React.ReactNode;
  showOnce?: boolean; // If true, never show again after dismissal
}

const TOOLTIP_STORAGE_KEY = 'app_tooltips_viewed';

function getViewedTooltips(): string[] {
  try {
    const stored = localStorage.getItem(TOOLTIP_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function markTooltipViewed(id: string) {
  const viewed = getViewedTooltips();
  if (!viewed.includes(id)) {
    viewed.push(id);
    localStorage.setItem(TOOLTIP_STORAGE_KEY, JSON.stringify(viewed));
  }
}

export function TooltipGuide({
  id,
  title,
  description,
  position = 'bottom',
  className,
  children,
  showOnce = true,
}: TooltipGuideProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (showOnce) {
      const viewed = getViewedTooltips();
      if (!viewed.includes(id)) {
        // Small delay to let the page render first
        const timer = setTimeout(() => setIsVisible(true), 500);
        return () => clearTimeout(timer);
      }
    } else {
      setIsVisible(true);
    }
  }, [id, showOnce]);

  const handleDismiss = () => {
    setIsVisible(false);
    if (showOnce) {
      markTooltipViewed(id);
    }
  };

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-primary border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-primary border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-primary border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-primary border-t-transparent border-b-transparent border-l-transparent',
  };

  return (
    <div className={cn('relative inline-block', className)}>
      {children}
      {isVisible && (
        <div
          className={cn(
            'absolute z-50 w-64 animate-in fade-in-0 zoom-in-95',
            positionClasses[position]
          )}
        >
          <div className="bg-primary text-primary-foreground rounded-lg shadow-lg p-3">
            <div className="flex items-start gap-2">
              <Lightbulb size={16} className="shrink-0 mt-0.5 text-primary-foreground/80" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-xs text-primary-foreground/90 mt-0.5">{description}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={handleDismiss}
              >
                <X size={12} />
              </Button>
            </div>
          </div>
          {/* Arrow */}
          <div
            className={cn(
              'absolute w-0 h-0 border-[6px]',
              arrowClasses[position]
            )}
          />
        </div>
      )}
    </div>
  );
}

// Utility to reset all tooltips (for testing)
export function resetTooltipGuides() {
  localStorage.removeItem(TOOLTIP_STORAGE_KEY);
}

// Simpler inline tooltip for quick hints
interface InlineHintProps {
  id: string;
  text: string;
  className?: string;
}

export function InlineHint({ id, text, className }: InlineHintProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const viewed = getViewedTooltips();
    if (!viewed.includes(id)) {
      setIsVisible(true);
    }
  }, [id]);

  const handleDismiss = () => {
    setIsVisible(false);
    markTooltipViewed(id);
  };

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 bg-info/10 text-info rounded-lg px-3 py-2 text-xs',
        className
      )}
    >
      <Lightbulb size={14} className="shrink-0" />
      <span className="flex-1">{text}</span>
      <button onClick={handleDismiss} className="shrink-0 hover:opacity-70">
        <X size={14} />
      </button>
    </div>
  );
}
